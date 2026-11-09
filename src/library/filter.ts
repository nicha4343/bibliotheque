import { NO_READING, readingsByBook, type ReadingFields } from '../books/readings';
import type { Book, Copy, Id, Loan, Reading, ReadingStatus } from '../db/schema';

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
  reading: ReadingFields;
  copies: Copy[];
  /** Loans in progress of its copies, the earliest first. */
  loans: Loan[];
  /** Folded title, authors, tags, series and ISBN, searched by the query. */
  haystack: string;
  sortKey: string;
}

/** Loans given back are left out by the caller or here: only those in progress count. */
export function toEntries(
  books: readonly Book[],
  copies: readonly Copy[],
  loans: readonly Loan[] = [],
  readings: readonly Reading[] = [],
): LibraryEntry[] {
  const readingOf = readingsByBook(readings);
  const byBook = new Map<Id, Copy[]>();
  const bookOfCopy = new Map<Id, Id>();
  for (const copy of copies) {
    bookOfCopy.set(copy.id, copy.bookId);
    const list = byBook.get(copy.bookId);
    if (list) list.push(copy);
    else byBook.set(copy.bookId, [copy]);
  }
  const loansByBook = new Map<Id, Loan[]>();
  for (const loan of [...loans].sort((a, b) => a.lentAt - b.lentAt)) {
    const bookId = bookOfCopy.get(loan.copyId);
    if (loan.returnedAt !== undefined || !bookId) continue;
    const list = loansByBook.get(bookId);
    if (list) list.push(loan);
    else loansByBook.set(bookId, [loan]);
  }
  return books
    .map((book) => ({
      book,
      reading: readingOf.get(book.id) ?? NO_READING,
      copies: (byBook.get(book.id) ?? []).sort((a, b) => a.addedAt - b.addedAt),
      loans: loansByBook.get(book.id) ?? [],
      // A series read from the title is already in the title.
      haystack: [
        foldText(book.title),
        ...book.authors.map(foldText),
        ...book.tags.map(foldText),
        foldText(book.seriesName ?? ''),
        book.isbn13 ?? '',
        book.isbn10 ?? '',
      ].join('\n'),
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

/** Reading status, or « Prêtés » (lot 4): at least one copy lent. */
export type StatusFilter = 'all' | ReadingStatus | 'lent';

export const matchesStatus = (entry: LibraryEntry, status: StatusFilter): boolean =>
  status === 'all' || (status === 'lent' ? entry.loans.length > 0 : entry.reading.status === status);
