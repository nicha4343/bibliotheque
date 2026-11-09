import type { BookMetadata, MetadataProvider } from '../db/schema';
import { mergeRecords } from './merge';
import { parseBnf, parseGoogleBooks, parseOpenLibrary, sourceUrl, type SourceRecord } from './sources';

// Long enough for Google Books to wait its turn and be asked again after a refusal.
export const SEARCH_TIMEOUT_MS = 12_000;

/** Every source failed (no network, timeout, quota): the ISBN must be searched again later. */
export class SearchUnavailable extends Error {
  constructor() {
    super('No source answered');
  }
}

/** failed: no answer; retry when asking again a moment later may succeed (quota, server, network). */
type Answer = { status: 'found'; record: SourceRecord } | { status: 'notFound' } | { status: 'failed'; retry: boolean };

type SourceOptions = { signal: AbortSignal; fetchImpl: typeof fetch; googleBooksKey: string | undefined };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Google's daily quotas start again at midnight, Pacific time (9 h in Paris). */
export function nextPacificMidnight(now: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const elapsed = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + (now % 1000);
  return now - elapsed + DAY_MS;
}

/**
 * Google Books refuses everything until its quota starts again: its daily quota is spent (shared
 * by every device using the key), or there is no key, the quota of
 * requests without a key being nil (seen on 9 November 2026). It is then not asked again before.
 */
export interface GoogleBooksPause {
  until: number;
  /** No key: the next day will be refused as well. */
  keyless: boolean;
}

let googleBooksDayOver: GoogleBooksPause | undefined;

export const googleBooksPause = (now = Date.now()): GoogleBooksPause | undefined =>
  googleBooksDayOver && googleBooksDayOver.until > now ? googleBooksDayOver : undefined;

async function askSource(provider: MetadataProvider, isbn13: string, options: SourceOptions): Promise<Answer> {
  try {
    const response = await options.fetchImpl(sourceUrl(provider, isbn13, options.googleBooksKey), {
      signal: options.signal,
    });
    // « Queries per day » (the quota of the day) and « Queries per minute per user » (a burst) both answer
    // 429 « rateLimitExceeded »: only the message tells them apart.
    if (provider === 'googleBooks' && response.status === 429 && /per day/i.test(await response.text())) {
      googleBooksDayOver = { until: nextPacificMidnight(Date.now()), keyless: !options.googleBooksKey?.trim() };
      return { status: 'failed', retry: false };
    }
    // 429: a burst refused; not a sign that the book is unknown.
    if (!response.ok) return { status: 'failed', retry: response.status === 429 || response.status >= 500 };
    const record =
      provider === 'bnf'
        ? parseBnf(await response.text())
        : provider === 'googleBooks'
          ? parseGoogleBooks(await response.json())
          : parseOpenLibrary(await response.json());
    return record?.title ? { status: 'found', record } : { status: 'notFound' };
  } catch {
    return { status: 'failed', retry: true };
  }
}

/**
 * Google Books refuses bursts of requests, even with a key, and sometimes fails for a moment: its
 * requests leave at least spacingMs apart, whatever asks them (scan, « Rechercher de nouveau »,
 * import). Every source refusing for a moment (quota, server, network) is asked again after each of
 * the retry delays: the BnF too refuses a burst (429, seen on 9 November 2026).
 */
export interface SourcePacing {
  spacingMs: number;
  retryDelaysMs: readonly number[];
}

let pacing: SourcePacing = { spacingMs: 1000, retryDelaysMs: [1500, 3500] };
let googleBooksFreeAt = 0;

/** Unit tests do without the pauses, and start with a Google Books that answers. */
export function setSourcePacing(value: SourcePacing): void {
  pacing = value;
  googleBooksFreeAt = 0;
  googleBooksDayOver = undefined;
}

/** Waits, unless the search is abandoned meanwhile. */
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (milliseconds <= 0 || signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Waits for the turn of a Google Books request, whatever asks it (also the search by title). */
export async function waitGoogleBooksTurn(signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const turn = Math.max(now, googleBooksFreeAt);
  googleBooksFreeAt = turn + pacing.spacingMs;
  await pause(turn - now, signal);
}

/** A source, asked again while it refuses for a moment; Google Books waits for its turn. */
async function askAgain(provider: MetadataProvider, isbn13: string, options: SourceOptions): Promise<Answer> {
  if (provider === 'googleBooks' && googleBooksPause()) return { status: 'failed', retry: false };
  for (let attempt = 0; ; attempt += 1) {
    if (provider === 'googleBooks') await waitGoogleBooksTurn(options.signal);
    const answer = await askSource(provider, isbn13, options);
    const delay = pacing.retryDelaysMs[attempt];
    if (answer.status !== 'failed' || !answer.retry || delay === undefined || options.signal.aborted) return answer;
    await pause(delay, options.signal);
  }
}

export interface SearchOptions {
  sources: Record<MetadataProvider, boolean>;
  /** The user's own Google Books key, if any. */
  googleBooksKey?: string | undefined;
  /** Called each time a source brings a usable record, with everything merged so far. */
  onProgress?: (metadata: BookMetadata) => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Queries the enabled sources in parallel. Resolves with the merged metadata (providers empty when
 * the ISBN is unknown everywhere); rejects with SearchUnavailable when no source could answer.
 */
export async function searchMetadata(isbn13: string, options: SearchOptions): Promise<BookMetadata> {
  const providers = (Object.keys(options.sources) as MetadataProvider[]).filter((provider) => options.sources[provider]);
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? SEARCH_TIMEOUT_MS);
  const records: SourceRecord[] = [];
  const answered = new Set<MetadataProvider>();

  try {
    await Promise.all(
      providers.map(async (provider) => {
        const sourceOptions = { signal: controller.signal, fetchImpl, googleBooksKey: options.googleBooksKey };
        const answer = await askAgain(provider, isbn13, sourceOptions);
        if (answer.status === 'failed') return;
        answered.add(provider);
        if (answer.status === 'found') {
          records.push(answer.record);
          options.onProgress?.(mergeRecords(isbn13, records));
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }

  if (records.length === 0 && answered.size === 0) throw new SearchUnavailable();
  const metadata = mergeRecords(isbn13, records);
  const silent = providers.filter((provider) => !answered.has(provider));
  if (silent.length > 0) {
    metadata.incomplete = true;
    metadata.silent = silent;
  }
  return metadata;
}
