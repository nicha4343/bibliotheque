import { db, type LibraryDatabase } from '../db/db';
import type { Book, SharedPlace, SharedPlaceContents } from '../db/schema';
import { indexPlaces, type PlaceIndex } from '../places/places';

// Lot 13: what the screens of a place shared with the user read from its copy.

/** Rooms and shelves of the place, as the place filter and the copies need them. */
export const sharedPlaceIndex = (contents: SharedPlaceContents): PlaceIndex =>
  indexPlaces([contents.site], contents.rooms, contents.shelves);

/** The places shared with the user, in the order of their names, ended ones included. */
export async function loadSharedPlaces(database: LibraryDatabase = db): Promise<SharedPlace[]> {
  return (await database.sharedPlaces.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** A book of a place shared with the user, found by its ISBN (« En librairie »). */
export interface SharedBookMatch {
  place: string;
  book: Book;
  /** « Salon · Étagère 2 », where a copy stands; undefined when every copy is declared lost. */
  label?: string;
}

export async function findSharedBook(isbn13: string, database: LibraryDatabase = db): Promise<SharedBookMatch | undefined> {
  for (const place of await loadSharedPlaces(database)) {
    const book = place.contents?.books.find((candidate) => candidate.isbn13 === isbn13);
    if (!place.contents || !book) continue;
    const copy = place.contents.copies.find((candidate) => candidate.bookId === book.id && candidate.lostAt === undefined);
    const label = copy ? sharedPlaceIndex(place.contents).byShelfId.get(copy.shelfId)?.roomLabel : undefined;
    return label ? { place: place.name, book, label } : { place: place.name, book };
  }
  return undefined;
}
