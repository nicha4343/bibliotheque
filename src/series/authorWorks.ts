import type { Book } from '../db/schema';
import { toIsbn13 } from '../isbn/isbn';
import { sortKey } from '../library/filter';
import { authorKey } from './series';

// « Du même auteur » (screen 9): the other works of an author, according to Open Library, whose search
// gives for each work its best edition in French (title and ISBN). Online only.

export interface AuthorWork {
  /** Open Library work, « /works/OL1230613W ». */
  key: string;
  title: string;
  year?: number;
  isbn13?: string;
}

const LIMIT = 60;

export function authorWorksUrl(name: string): string {
  const fields = 'key,title,first_publish_year,author_name,editions,editions.title,editions.language,editions.isbn';
  return `https://openlibrary.org/search.json?author=${encodeURIComponent(name)}&fields=${fields}&lang=fr&limit=${LIMIT}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** Main title, without its subtitle, folded: « La Peste : roman » and « La peste » are one work. */
export const workKey = (title: string): string =>
  sortKey(title.split(/\s[:;(]|[:;(]\s/)[0] ?? title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Works of the answer written by the author (Open Library also matches close names), with a French
 * edition, in the order of Open Library (the most published first), without duplicate titles.
 */
export function parseAuthorWorks(json: unknown, name: string): AuthorWork[] {
  if (!isObject(json) || !Array.isArray(json.docs)) return [];
  const author = authorKey(name);
  const seen = new Set<string>();
  const works: AuthorWork[] = [];
  for (const doc of json.docs) {
    if (!isObject(doc) || typeof doc.key !== 'string') continue;
    if (!strings(doc.author_name).some((other) => authorKey(other) === author)) continue;
    const editions = isObject(doc.editions) && Array.isArray(doc.editions.docs) ? doc.editions.docs.filter(isObject) : [];
    const edition = editions.find((item) => strings(item.language).includes('fre'));
    if (!edition) continue;
    const title = (typeof edition.title === 'string' ? edition.title : typeof doc.title === 'string' ? doc.title : '')
      .replace(/\s+/g, ' ')
      .replace(/[\s.]+$/, '')
      .trim();
    const key = workKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const work: AuthorWork = { key: doc.key, title: title.charAt(0).toLocaleUpperCase('fr') + title.slice(1) };
    if (typeof doc.first_publish_year === 'number') work.year = doc.first_publish_year;
    const isbn13 = strings(edition.isbn).map((isbn) => toIsbn13(isbn)).find(Boolean);
    if (isbn13) work.isbn13 = isbn13;
    works.push(work);
  }
  return works;
}

/** Works the library does not have: neither the ISBN of their edition nor their title. */
export function missingWorks(works: readonly AuthorWork[], books: readonly Book[]): AuthorWork[] {
  const isbns = new Set(books.flatMap((book) => (book.isbn13 ? [book.isbn13] : [])));
  const titles = new Set(books.map((book) => workKey(book.title)));
  return works.filter((work) => !(work.isbn13 && isbns.has(work.isbn13)) && !titles.has(workKey(work.title)));
}

/** Rejects when Open Library cannot be reached. */
export async function searchAuthorWorks(name: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<AuthorWork[]> {
  const response = await fetchImpl(authorWorksUrl(name), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Open Library answered ${response.status}`);
  return parseAuthorWorks(await response.json(), name);
}
