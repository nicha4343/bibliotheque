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

async function askSource(
  provider: MetadataProvider,
  isbn13: string,
  options: { signal: AbortSignal; fetchImpl: typeof fetch; googleBooksKey: string | undefined },
): Promise<Answer> {
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
 * import), and a refusal is asked again after each of the retry delays.
 */
export interface GoogleBooksPacing {
  spacingMs: number;
  retryDelaysMs: readonly number[];
}

let pacing: GoogleBooksPacing = { spacingMs: 1000, retryDelaysMs: [1500, 3500] };
let googleBooksFreeAt = 0;

/** Unit tests do without the pauses. */
export function setGoogleBooksPacing(value: GoogleBooksPacing): void {
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

async function askGoogleBooks(
  isbn13: string,
  options: { signal: AbortSignal; fetchImpl: typeof fetch; googleBooksKey: string | undefined },
): Promise<Answer> {
  for (let attempt = 0; ; attempt += 1) {
    const now = Date.now();
    const turn = Math.max(now, googleBooksFreeAt);
    googleBooksFreeAt = turn + pacing.spacingMs;
    await pause(turn - now, options.signal);
    const answer = await askSource('googleBooks', isbn13, options);
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

  try {
    await Promise.all(
      providers.map(async (provider) => {
        const sourceOptions = { signal: controller.signal, fetchImpl, googleBooksKey: options.googleBooksKey };
        const answer =
          provider === 'googleBooks' ? await askGoogleBooks(isbn13, sourceOptions) : await askSource(provider, isbn13, sourceOptions);
        if (answer.status === 'failed') return;
        answered += 1;
        if (answer.status === 'found') {
          records.push(answer.record);
          options.onProgress?.(mergeRecords(isbn13, records));
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }

  if (records.length === 0 && answered === 0) throw new SearchUnavailable();
  const metadata = mergeRecords(isbn13, records);
  if (answered < providers.length) metadata.incomplete = true;
  return metadata;
}
