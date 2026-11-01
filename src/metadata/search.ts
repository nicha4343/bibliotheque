import type { BookMetadata, MetadataProvider } from '../db/schema';
import { mergeRecords } from './merge';
import { parseBnf, parseGoogleBooks, parseOpenLibrary, sourceUrl, type SourceRecord } from './sources';

export const SEARCH_TIMEOUT_MS = 8000;

/** Every source failed (no network, timeout, quota): the ISBN must be searched again later. */
export class SearchUnavailable extends Error {
  constructor() {
    super('No source answered');
  }
}

type Answer = { status: 'found'; record: SourceRecord } | { status: 'notFound' } | { status: 'failed' };

async function askSource(
  provider: MetadataProvider,
  isbn13: string,
  options: { signal: AbortSignal; fetchImpl: typeof fetch; googleBooksKey: string | undefined },
): Promise<Answer> {
  try {
    const response = await options.fetchImpl(sourceUrl(provider, isbn13, options.googleBooksKey), {
      signal: options.signal,
    });
    // 429: Google Books quota exhausted; not a sign that the book is unknown.
    if (!response.ok) return { status: 'failed' };
    const record =
      provider === 'bnf'
        ? parseBnf(await response.text())
        : provider === 'googleBooks'
          ? parseGoogleBooks(await response.json())
          : parseOpenLibrary(await response.json());
    return record?.title ? { status: 'found', record } : { status: 'notFound' };
  } catch {
    return { status: 'failed' };
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
        const answer = await askSource(provider, isbn13, {
          signal: controller.signal,
          fetchImpl,
          googleBooksKey: options.googleBooksKey,
        });
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
  return mergeRecords(isbn13, records);
}
