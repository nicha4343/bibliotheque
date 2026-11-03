import type { MetadataProvider } from '../db/schema';
import { toIsbn13 } from '../isbn/isbn';
import { foldText } from '../library/filter';
import { waitGoogleBooksTurn } from './search';
import { bnfRecord, googleBooksVolume, unimarcRecords, unimarcValue, type SourceRecord } from './sources';

// Search of a book by its title and author, dictated or typed (screen 4, lot 6): an item without a
// barcode, or whose ISBN no source knows, is found in the catalogues by its words. The three sources
// are asked at once; the user touches the edition that matches to fill the form.

/** An edition found by a search; what it gives the form is its title, authors and publisher. */
export interface FoundEdition {
  provider: MetadataProvider;
  title: string;
  authors: string[];
  publisher?: string;
  year?: number;
  isbn13?: string;
  coverUrl?: string;
  /** « fr », « en »…: French editions come first. */
  language?: string;
}

const RESULTS_PER_SOURCE = 10;
const MAX_RESULTS = 8;
const TIMEOUT_MS = 12_000;

/** « le Lotus bleu de Hergé » → « lotus bleu hergé »: the BnF demands every word of the query. */
const STOP_WORDS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'de', 'du', 'des', 'd', 'par', 'et', 'a', 'au', 'aux', 'en', 'tome']);

export function catalogWords(query: string): string {
  return foldText(query)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(' ');
}

export function googleBooksSearchUrl(query: string, googleBooksKey = ''): string {
  const key = googleBooksKey.trim() ? `&key=${encodeURIComponent(googleBooksKey.trim())}` : '';
  return `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${RESULTS_PER_SOURCE}&printType=books${key}`;
}

export function bnfSearchUrl(query: string): string {
  const words = catalogWords(query).replace(/"/g, ' ');
  return `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&recordSchema=unimarcxchange&maximumRecords=${RESULTS_PER_SOURCE}&query=${encodeURIComponent(`bib.anywhere all "${words}"`)}`;
}

/** Open Library gives each work with its edition in French that best matches. */
export function openLibrarySearchUrl(query: string): string {
  const fields = 'key,title,author_name,first_publish_year,cover_i,editions,editions.language,editions.isbn,editions.publisher,editions.publish_date';
  return `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=${fields}&lang=fr&limit=${RESULTS_PER_SOURCE}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const tidy = (text: string): string => text.replace(/\s+/g, ' ').replace(/[\s.,;:/]+$/, '').trim();

function edition(record: SourceRecord | undefined, extra: { title?: string | undefined; isbn13?: string | undefined } = {}): FoundEdition | undefined {
  const title = tidy(extra.title ?? record?.title ?? '');
  if (!record || !title) return undefined;
  const found: FoundEdition = { provider: record.provider, title, authors: record.authors ?? [] };
  if (record.publisher) found.publisher = record.publisher;
  if (record.year) found.year = record.year;
  if (record.coverUrl) found.coverUrl = record.coverUrl;
  if (record.language) found.language = record.language;
  if (extra.isbn13) found.isbn13 = extra.isbn13;
  return found;
}

export function parseGoogleBooksResults(json: unknown): FoundEdition[] {
  if (!isObject(json) || !Array.isArray(json.items)) return [];
  return json.items.flatMap((item: unknown) => {
    const info = isObject(item) && isObject(item.volumeInfo) ? item.volumeInfo : {};
    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers.filter(isObject) : [];
    const isbn = identifiers.find((identifier) => identifier.type === 'ISBN_13')?.identifier;
    const found = edition(googleBooksVolume(item), { isbn13: typeof isbn === 'string' ? toIsbn13(isbn) : undefined });
    return found ? [found] : [];
  });
}

export function parseBnfResults(xml: string): FoundEdition[] {
  return unimarcRecords(xml).flatMap((fields) => {
    const isbn = unimarcValue(fields, '010', 'a');
    // The title proper, without its other titles (« les aventures de Tintin reporter en Extrême-Orient »).
    const found = edition(bnfRecord(fields), { title: unimarcValue(fields, '200', 'a'), isbn13: isbn ? toIsbn13(isbn) : undefined });
    return found ? [found] : [];
  });
}

export function parseOpenLibraryResults(json: unknown): FoundEdition[] {
  if (!isObject(json) || !Array.isArray(json.docs)) return [];
  return json.docs.flatMap((doc: unknown) => {
    if (!isObject(doc) || typeof doc.title !== 'string') return [];
    const editions = isObject(doc.editions) && Array.isArray(doc.editions.docs) ? doc.editions.docs.filter(isObject) : [];
    const french = editions.find((item) => strings(item.language).includes('fre'));
    const record: SourceRecord = { provider: 'openLibrary', title: doc.title, authors: strings(doc.author_name) };
    const publisher = strings(french?.publisher)[0];
    if (publisher) record.publisher = publisher;
    const year = /\b(1[4-9]\d\d|20\d\d)\b/.exec(strings(french?.publish_date)[0] ?? '')?.[1];
    if (year) record.year = Number(year);
    else if (typeof doc.first_publish_year === 'number') record.year = doc.first_publish_year;
    if (typeof doc.cover_i === 'number') record.coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
    if (french) record.language = 'fr';
    const found = edition(record, { isbn13: strings(french?.isbn).map((isbn) => toIsbn13(isbn)).find(Boolean) });
    return found ? [found] : [];
  });
}

/** « Le Lotus bleu » by Hergé at Casterman is one result, whatever the year and the source. */
const editionKey = (found: FoundEdition): string =>
  [found.title, found.authors[0] ?? '', found.publisher ?? ''].map((part) => catalogWords(part)).join('|');

/**
 * How well an edition answers the words searched: the more of them its title and authors contain,
 * and the fewer other words its title has (« Le Lotus bleu » before « Le Lotus bleu décrypté »).
 */
function relevance(found: FoundEdition, words: ReadonlySet<string>): number {
  const own = new Set(catalogWords([found.title, ...found.authors].join(' ')).split(' '));
  const matched = [...words].filter((word) => own.has(word)).length;
  const extra = catalogWords(found.title)
    .split(' ')
    .filter((word) => word && !words.has(word)).length;
  return matched * 10 - extra;
}

/**
 * The answers that best match the words searched first; for equal matches, French editions before
 * translations, then the best answers of each source in turn. Without duplicates.
 */
export function mergeEditions(lists: readonly (readonly FoundEdition[])[], query = '', limit = MAX_RESULTS): FoundEdition[] {
  const interleaved: FoundEdition[] = [];
  for (let rank = 0; rank < Math.max(0, ...lists.map((list) => list.length)); rank += 1) {
    for (const list of lists) {
      const found = list[rank];
      if (found) interleaved.push(found);
    }
  }
  const words = new Set(catalogWords(query).split(' ').filter(Boolean));
  const french = (found: FoundEdition) => (!found.language || found.language === 'fr' ? 1 : 0);
  const seen = new Set<string>();
  return interleaved
    .map((found, rank) => ({ found, rank, score: relevance(found, words), french: french(found) }))
    .sort((a, b) => b.score - a.score || b.french - a.french || a.rank - b.rank)
    .map(({ found }) => found)
    .filter((found) => {
      const key = editionKey(found);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export interface EditionSearchOptions {
  sources: Record<MetadataProvider, boolean>;
  googleBooksKey?: string | undefined;
  fetchImpl?: typeof fetch;
}

/** unavailable: no source could be reached (no network, Google Books over its quota…). */
export async function searchEditions(query: string, options: EditionSearchOptions): Promise<{ editions: FoundEdition[]; unavailable: boolean }> {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const ask = async (provider: MetadataProvider): Promise<FoundEdition[] | undefined> => {
    try {
      if (provider === 'googleBooks') {
        await waitGoogleBooksTurn(signal);
        const response = await fetchImpl(googleBooksSearchUrl(query, options.googleBooksKey), { signal });
        return response.ok ? parseGoogleBooksResults(await response.json()) : undefined;
      }
      const response = await fetchImpl(provider === 'bnf' ? bnfSearchUrl(query) : openLibrarySearchUrl(query), { signal });
      if (!response.ok) return undefined;
      return provider === 'bnf' ? parseBnfResults(await response.text()) : parseOpenLibraryResults(await response.json());
    } catch {
      return undefined;
    }
  };
  // Google Books ranks best, then the BnF, which knows the old French books, then Open Library.
  const providers = (['googleBooks', 'bnf', 'openLibrary'] as const).filter((provider) => options.sources[provider]);
  const answers = await Promise.all(providers.map(ask));
  const lists = answers.filter((answer): answer is FoundEdition[] => answer !== undefined);
  return { editions: mergeEditions(lists, query), unavailable: lists.length === 0 };
}
