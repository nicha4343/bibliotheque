import type { Book, Copy, Id, ReadingStatus } from '../db/schema';

/** « Éléphant » → « elephant »: comparisons ignore case and accents. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, "'")
    .trim();
}

// Leading articles are ignored when sorting: « L’Étranger » sits under E.
const ARTICLE = /^(?:l'|le |la |les |un |une |des |the |a |an )/;

export function sortKey(title: string): string {
  return foldText(title).replace(ARTICLE, '');
}

/** A notice with what the list shows of its copies. */
export interface LibraryEntry {
  book: Book;
  copies: Copy[];
  /** Folded title, authors, tags and ISBN, searched by the query. */
  haystack: string;
  sortKey: string;
}

export function toEntries(books: readonly Book[], copies: readonly Copy[]): LibraryEntry[] {
  const byBook = new Map<Id, Copy[]>();
  for (const copy of copies) {
    const list = byBook.get(copy.bookId);
    if (list) list.push(copy);
    else byBook.set(copy.bookId, [copy]);
  }
  return books
    .map((book) => ({
      book,
      copies: (byBook.get(book.id) ?? []).sort((a, b) => a.addedAt - b.addedAt),
      haystack: [foldText(book.title), ...book.authors.map(foldText), ...book.tags.map(foldText), book.isbn13 ?? '', book.isbn10 ?? ''].join(
        '\n',
      ),
      sortKey: sortKey(book.title),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'fr') || a.book.createdAt - b.book.createdAt);
}

/** Every word of the query must appear; an ISBN may be typed with hyphens or spaces. */
export function matchesQuery(entry: LibraryEntry, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const digits = query.replace(/[\s-]/g, '');
  if (/^\d{4,}[\dxX]?$/.test(digits)) return entry.haystack.includes(digits.toUpperCase());
  return words.every((word) => entry.haystack.includes(word));
}

export type PlaceFilter = { kind: 'all' } | { kind: 'room'; shelfIds: ReadonlySet<Id> } | { kind: 'shelf'; shelfId: Id };

/** First copy that is not declared lost: the list shows where it is. */
export const firstPresentCopy = (entry: LibraryEntry): Copy | undefined => entry.copies.find((copy) => copy.lostAt === undefined);

/** A copy declared lost is no longer in its room or on its shelf. */
export function matchesPlace(entry: LibraryEntry, place: PlaceFilter): boolean {
  const present = entry.copies.filter((copy) => copy.lostAt === undefined);
  switch (place.kind) {
    case 'all':
      return true;
    case 'room':
      return present.some((copy) => place.shelfIds.has(copy.shelfId));
    case 'shelf':
      return present.some((copy) => copy.shelfId === place.shelfId);
  }
}

export type StatusFilter = 'all' | ReadingStatus;

export const matchesStatus = (entry: LibraryEntry, status: StatusFilter): boolean =>
  status === 'all' || entry.book.status === status;
