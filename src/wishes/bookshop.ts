import { db, type LibraryDatabase } from '../db/db';
import type { Book, BookMetadata, Copy, Loan, SeriesRecord, Wish } from '../db/schema';
import { isActive } from '../loans/loans';
import { groupSeries, seriesKey, seriesOf, type SeriesGroup, type SeriesPart } from '../series/series';
import { findWish } from './wishes';

// « En librairie » (screen 11): a book scanned in a bookshop is already owned, wished, or absent. Owned
// and wished are known without network; the title of an absent book, and its series, come from the
// sources.

export type BookshopVerdict =
  | { kind: 'owned'; book: Book; copies: Copy[]; lentTo?: string }
  | { kind: 'wished'; wish: Wish }
  | { kind: 'absent' };

export function classifyBookshop(
  isbn13: string,
  books: readonly Book[],
  copies: readonly Copy[],
  wishes: readonly Wish[],
  loans: readonly Loan[] = [],
): BookshopVerdict {
  const book = books.find((item) => item.isbn13 === isbn13);
  if (book) {
    const own = copies.filter((copy) => copy.bookId === book.id);
    const ids = new Set(own.map((copy) => copy.id));
    const loan = loans.find((item) => ids.has(item.copyId) && isActive(item));
    return loan ? { kind: 'owned', book, copies: own, lentTo: loan.borrower } : { kind: 'owned', book, copies: own };
  }
  const wish = wishes.find((item) => item.isbn === isbn13);
  return wish ? { kind: 'wished', wish } : { kind: 'absent' };
}

export async function loadBookshopCheck(isbn13: string, database: LibraryDatabase = db): Promise<BookshopVerdict> {
  const [book, wishes] = await Promise.all([database.books.where('isbn13').equals(isbn13).first(), database.wishes.toArray()]);
  if (!book) return classifyBookshop(isbn13, [], [], wishes);
  const copies = await database.copies.where('bookId').equals(book.id).toArray();
  const loans = copies.length > 0 ? await database.loans.where('copyId').anyOf(copies.map((copy) => copy.id)).toArray() : [];
  return classifyBookshop(isbn13, [book], copies, wishes, loans);
}

/** What the sources tell of an absent book: a series of the library, a wish under another form. */
export interface BookshopDetails {
  series?: SeriesPart;
  /** The series in the library, when the user owns other volumes. */
  group?: SeriesGroup;
  /** A wish for this very book (its volume of the series, its title and author). */
  wish?: Wish;
}

export function bookshopDetails(
  metadata: BookMetadata,
  books: readonly Book[],
  wishes: readonly Wish[],
  records: readonly SeriesRecord[] = [],
): BookshopDetails {
  const title = metadata.title ?? '';
  const series = seriesOf({ title, seriesName: metadata.seriesName, seriesIndex: metadata.seriesIndex });
  const details: BookshopDetails = {};
  if (series) {
    details.series = series;
    const key = seriesKey(series.name);
    const group = groupSeries(books, records).find((item) => item.key === key);
    if (group) details.group = group;
  }
  const wish = findWish(wishes, {
    isbn: metadata.isbn13,
    title,
    author: metadata.authors?.[0],
    seriesName: details.group?.name ?? series?.name,
    seriesIndex: series?.index,
  });
  if (wish) details.wish = wish;
  return details;
}

export async function loadBookshopDetails(metadata: BookMetadata, database: LibraryDatabase = db): Promise<BookshopDetails> {
  const [books, wishes, records] = await Promise.all([database.books.toArray(), database.wishes.toArray(), database.series.toArray()]);
  return bookshopDetails(metadata, books, wishes, records);
}
