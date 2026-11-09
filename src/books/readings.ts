import type { Book, Id, Reading, ReadingStatus, Timestamp } from '../db/schema';

// « Ma lecture » (lot 12): status, rating and review belong to each person, apart from the notices that a
// place shared with the family will hold in common.

export type ReadingFields = Pick<Reading, 'status' | 'rating' | 'review'>;

/** The reading of a book without a record. */
export const NO_READING: ReadingFields = { status: 'toread', rating: 0, review: '' };

type LooseReading = Partial<Record<keyof ReadingFields, unknown>>;

/**
 * Reading held by a notice before lot 12, by a backup up to format 4 or by a CSV file; undefined when there
 * is nothing to keep (to read, not rated, no review).
 */
export function readingFrom(bookId: Id, fields: LooseReading, updatedAt: Timestamp): Reading | undefined {
  const status: ReadingStatus = fields.status === 'read' ? 'read' : 'toread';
  const rating = typeof fields.rating === 'number' && fields.rating >= 1 ? Math.min(5, Math.round(fields.rating)) : 0;
  const review = typeof fields.review === 'string' ? fields.review : '';
  if (status === 'toread' && rating === 0 && review === '') return undefined;
  return { bookId, status, rating, review, updatedAt };
}

/** A notice as stored before lot 12: its reading leaves it. */
export function splitReading(stored: Book & LooseReading): { book: Book; reading: Reading | undefined } {
  const { status, rating, review, ...book } = stored;
  return { book, reading: readingFrom(book.id, { status, rating, review }, book.updatedAt) };
}

export const readingsByBook = (readings: readonly Reading[]): Map<Id, Reading> =>
  new Map(readings.map((reading) => [reading.bookId, reading]));
