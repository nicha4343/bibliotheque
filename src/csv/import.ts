import { readingFrom } from '../books/readings';
import { db, type LibraryDatabase } from '../db/db';
import type { Book, Copy, Id, Reading, Shelf } from '../db/schema';
import { findOrCreateShelf } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { fr } from '../textes/fr';
import { titleKey, type ImportedBook, type ImportedCopy } from './read';

// « Importer (CSV ou exportation Libib) »: the notices of the file that the library does not hold yet,
// with their copies. A notice already present is left untouched, so importing a file twice adds nothing.

interface OwnedIndex {
  isbns: Set<string>;
  titles: Set<string>;
}

async function ownedIndex(database: LibraryDatabase): Promise<OwnedIndex> {
  const books = await database.books.toArray();
  return {
    isbns: new Set(books.flatMap((book) => (book.isbn13 ? [book.isbn13] : []))),
    titles: new Set(books.map(titleKey)),
  };
}

/** With an ISBN, only the same ISBN counts (another edition is another notice); without, the title and first author. */
function isOwned(book: ImportedBook, owned: OwnedIndex): boolean {
  return book.fields.isbn13 ? owned.isbns.has(book.fields.isbn13) : owned.titles.has(titleKey(book.fields));
}

export interface ImportPreview {
  newBooks: ImportedBook[];
  copies: number;
  /** Notices of the file already in the library, left out. */
  owned: number;
  /** Some copies have no room in the file: a shelf must be chosen for them. */
  needsShelf: boolean;
}

export async function previewImport(books: readonly ImportedBook[], database: LibraryDatabase = db): Promise<ImportPreview> {
  const owned = await ownedIndex(database);
  const newBooks = books.filter((book) => !isOwned(book, owned));
  return {
    newBooks,
    copies: newBooks.reduce((total, book) => total + book.copies.length, 0),
    owned: books.length - newBooks.length,
    needsShelf: newBooks.some((book) => book.copies.some((copy) => !copy.room)),
  };
}

export interface ImportResult {
  bookIds: Id[];
  /** Notices with an ISBN, whose cover and missing fields can be searched. */
  searchableIds: Id[];
  copies: number;
}

/**
 * Adds the notices and their copies in one transaction: on failure, nothing is imported. Places, rooms
 * and shelves named in the file are created when missing; copies without one go to defaultShelfId.
 */
export async function applyImport(
  books: readonly ImportedBook[],
  defaultShelfId: Id | undefined,
  database: LibraryDatabase = db,
): Promise<ImportResult> {
  const tables = [database.sites, database.rooms, database.shelves, database.books, database.readings, database.copies];
  return database.transaction('rw', tables, async () => {
    const owned = await ownedIndex(database);
    const shelves = new Map<string, Shelf>();
    const shelfFor = async (copy: ImportedCopy): Promise<Id> => {
      if (!copy.room) {
        if (!defaultShelfId) throw new Error('A shelf must be chosen for the copies without a place');
        return defaultShelfId;
      }
      const shelfName = copy.shelf ?? fr.places.defaultShelfName(1);
      const key = [copy.site ?? '', copy.room, shelfName].map((name) => name.trim().toLocaleLowerCase('fr')).join('\n');
      let shelf = shelves.get(key);
      if (!shelf) {
        shelf = await findOrCreateShelf(copy.room, shelfName, database, copy.site);
        shelves.set(key, shelf);
      }
      return shelf.id;
    };

    const added: Book[] = [];
    const readings: Reading[] = [];
    const copies: Copy[] = [];
    for (const imported of books) {
      if (isOwned(imported, owned)) continue;
      const { status, rating, review, ...fields } = imported.fields;
      const book = newBook(fields);
      const dates = imported.copies.flatMap((copy) => (copy.addedAt === undefined ? [] : [copy.addedAt]));
      if (dates.length > 0) book.createdAt = Math.min(...dates);
      added.push(book);
      const reading = readingFrom(book.id, { status, rating, review }, book.updatedAt);
      if (reading) readings.push(reading);
      if (book.isbn13) owned.isbns.add(book.isbn13);
      owned.titles.add(titleKey(book));
      for (const importedCopy of imported.copies) {
        const copy = newCopy(book.id, await shelfFor(importedCopy));
        if (importedCopy.addedAt !== undefined) copy.addedAt = importedCopy.addedAt;
        if (importedCopy.note) copy.note = importedCopy.note;
        copies.push(copy);
      }
    }
    await database.books.bulkAdd(added);
    await database.readings.bulkAdd(readings);
    await database.copies.bulkAdd(copies);
    return {
      bookIds: added.map((book) => book.id),
      searchableIds: added.filter((book) => book.isbn13).map((book) => book.id),
      copies: copies.length,
    };
  });
}
