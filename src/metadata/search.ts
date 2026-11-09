import type { BookMetadata, MetadataProvider } from '../db/schema';
import { mergeRecords } from './merge';
import { parseBnf, parseGoogleBooks, parseOpenLibrary, sourceUrl, type OnlineProvider, type SourceRecord } from './sources';
import { findInTriompheCatalog } from './triomphe';

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

/** The list of the Éditions du Triomphe, inside the application: no request, so no refusal. */
async function askTriomphe(isbn13: string): Promise<Answer> {
  try {
    const record = await findInTriompheCatalog(isbn13);
    return record ? { status: 'found', record } : { status: 'notFound' };
  } catch {
    // Its file could not be loaded (application updated meanwhile, offline before the first use).
    return { status: 'failed', retry: false };
  }
}

async function askSource(provider: OnlineProvider, isbn13: string, options: SourceOptions): Promise<Answer> {
  try {
    const response = await options.fetchImpl(sourceUrl(provider, isbn13, options.googleBooksKey), {
      signal: options.signal,
    });
    // 429: Google Books quota exhausted, or a burst refused; not a sign that the book is unknown.
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

/** Unit tests do without the pauses. */
export function setSourcePacing(value: SourcePacing): void {
  pacing = value;
  googleBooksFreeAt = 0;
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

/** An online source, asked again while it refuses for a moment; Google Books waits for its turn. */
async function askOnline(provider: OnlineProvider, isbn13: string, options: SourceOptions): Promise<Answer> {
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
  let answered = 0;
  // The list inside the application always answers: without the network, a book it does not know is not
  // declared unknown, but searched again later (unless no source asked over the network is enabled).
  let answeredOnline = 0;
  const askedOnline = providers.some((provider) => provider !== 'triomphe');

  try {
    await Promise.all(
      providers.map(async (provider) => {
        const sourceOptions = { signal: controller.signal, fetchImpl, googleBooksKey: options.googleBooksKey };
        const answer = provider === 'triomphe' ? await askTriomphe(isbn13) : await askOnline(provider, isbn13, sourceOptions);
        if (answer.status === 'failed') return;
        answered += 1;
        if (provider !== 'triomphe') answeredOnline += 1;
        if (answer.status === 'found') {
          records.push(answer.record);
          options.onProgress?.(mergeRecords(isbn13, records));
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }

  if (records.length === 0 && (answered === 0 || (askedOnline && answeredOnline === 0))) throw new SearchUnavailable();
  const metadata = mergeRecords(isbn13, records);
  if (answered < providers.length) metadata.incomplete = true;
  return metadata;
}
