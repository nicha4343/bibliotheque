import { db, type LibraryDatabase } from '../db/db';
import type { Book, Copy, Id } from '../db/schema';
import { addTag, removeTag } from '../books/tags';
import { foldText, sortKey } from '../library/filter';
import type { PlaceIndex } from '../places/places';
import { fr, joinWithAnd } from '../textes/fr';

// « Doublons » (lot 5, screen 11): books owned in several copies, those to give marked by the tag
// « À donner », shared with the book sheet and searched by the library.

export interface Duplicate {
  book: Book;
  /** Copies not declared lost, the oldest first. */
  copies: Copy[];
  give: boolean;
}

export const isToGive = (book: Pick<Book, 'tags'>): boolean => book.tags.some((tag) => foldText(tag) === foldText(fr.duplicates.tag));

export function findDuplicates(books: readonly Book[], copies: readonly Copy[]): Duplicate[] {
  const byBook = new Map<Id, Copy[]>();
  for (const copy of copies) {
    if (copy.lostAt !== undefined) continue;
    byBook.set(copy.bookId, [...(byBook.get(copy.bookId) ?? []), copy]);
  }
  return books
    .flatMap((book) => {
      const own = (byBook.get(book.id) ?? []).sort((a, b) => a.addedAt - b.addedAt);
      return own.length > 1 ? [{ book, copies: own, give: isToGive(book) }] : [];
    })
    .sort((a, b) => sortKey(a.book.title).localeCompare(sortKey(b.book.title), 'fr'));
}

/** « Salon · Étagère 2 et Chambre · Table de chevet », « Bureau · Bandes dessinées (3) ». */
export function placesOf(copies: readonly Copy[], places: PlaceIndex): string {
  const counts = new Map<string, number>();
  for (const copy of copies) {
    const label = places.byShelfId.get(copy.shelfId)?.label ?? fr.library.noPlace;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return joinWithAnd([...counts].map(([label, value]) => (value > 1 ? fr.duplicates.placeCount(label, value) : label)));
}

/** « Exporter la liste (CSV) »: one row per book. */
export function duplicateRows(duplicates: readonly Duplicate[], places: PlaceIndex): string[][] {
  const { columns } = fr.duplicates;
  return [
    [columns.title, columns.authors, columns.isbn13, columns.copies, columns.places, columns.give],
    ...duplicates.map(({ book, copies, give }) => [
      book.title,
      book.authors.join(', '),
      book.isbn13 ?? '',
      String(copies.length),
      placesOf(copies, places),
      give ? fr.duplicates.yes : fr.duplicates.no,
    ]),
  ];
}

/** Marks the book « À donner », or takes the mark off, whatever the case of the tag. */
export async function setToGive(book: Book, give: boolean, database: LibraryDatabase = db): Promise<void> {
  if (give) {
    await addTag(book.id, fr.duplicates.tag, database);
    return;
  }
  for (const tag of book.tags.filter((label) => foldText(label) === foldText(fr.duplicates.tag))) await removeTag(book.id, tag, database);
}
