import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, BookMetadata, Cover, Id, PendingItem } from '../db/schema';
import { getSettings } from '../db/settings';
import { bookFieldsFromMetadata } from '../metadata/merge';
import { attachAutoCover, completeFromMetadata, findMetadata } from '../scan/lookups';
import { newBook, newCopy } from '../scan/session';

// The « À compléter » box (screens 3 and 4): unknown ISBNs and books without a barcode.

/** « Victor Hugo, Paul Meurice » → two authors; the field shows them joined the same way. */
export function parseAuthors(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((name) => name.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export const joinAuthors = (authors: readonly string[]): string => authors.join(', ');

/** Oldest first: the order in which they were put aside. */
export async function listPendingItems(database: LibraryDatabase = db): Promise<PendingItem[]> {
  return database.pendingItems.orderBy('createdAt').toArray();
}

/** The user's photograph of the item becomes the cover of its notice: it always wins. */
const userCover = (item: PendingItem): Cover | undefined =>
  item.photoBlobId ? { source: 'user', blobId: item.photoBlobId } : undefined;

/**
 * Notice and copy for an item, then the item is removed. When the ISBN has meanwhile entered the
 * library (scanned again once known), only a copy is added to the existing notice.
 */
async function resolveItem(
  item: PendingItem,
  fields: Pick<Book, 'title' | 'authors'> & Partial<Book>,
  shelfId: Id,
  database: LibraryDatabase,
): Promise<Id> {
  return database.transaction('rw', [database.pendingItems, database.books, database.copies, database.blobs], async () => {
    const isbn13 = fields.isbn13 ?? item.isbn;
    const existing = isbn13 ? await database.books.where('isbn13').equals(isbn13).first() : undefined;
    let bookId: Id;
    if (existing) {
      bookId = existing.id;
      if (item.photoBlobId && existing.cover?.source !== 'user') {
        if (existing.cover?.blobId) await database.blobs.delete(existing.cover.blobId);
        await database.books.update(bookId, { cover: userCover(item), updatedAt: Date.now() });
      } else if (item.photoBlobId) {
        await database.blobs.delete(item.photoBlobId);
      }
    } else {
      const book = newBook({ ...fields, ...(isbn13 ? { isbn13 } : {}) });
      const cover = userCover(item);
      if (cover) book.cover = cover;
      await database.books.add(book);
      bookId = book.id;
    }
    await database.copies.add(newCopy(bookId, shelfId));
    await database.pendingItems.delete(item.id);
    return bookId;
  });
}

export interface EntryFields {
  title: string;
  authors: string[];
  publisher: string;
}

/** « Enregistrer » on screen 4. Returns the notice, or undefined when the item no longer exists. */
export async function completeItem(
  itemId: Id,
  entry: EntryFields,
  shelfId: Id,
  database: LibraryDatabase = db,
): Promise<Id | undefined> {
  const item = await database.pendingItems.get(itemId);
  if (!item) return undefined;
  const fields: Pick<Book, 'title' | 'authors'> & Partial<Book> = { title: entry.title.trim(), authors: entry.authors };
  if (entry.publisher.trim()) fields.publisher = entry.publisher.trim();
  return resolveItem(item, fields, shelfId, database);
}

export type RetryOutcome = { status: 'found'; bookId: Id; title: string } | { status: 'unknown' } | { status: 'unavailable' };

/** « Rechercher de nouveau »: an unknown ISBN may have been catalogued since, or a source was down. */
export async function retryItem(itemId: Id, database: LibraryDatabase = db): Promise<RetryOutcome> {
  const item = await database.pendingItems.get(itemId);
  if (!item?.isbn) return { status: 'unknown' };
  const isbn13 = item.isbn;
  const metadata: BookMetadata | undefined = await findMetadata(isbn13, () => Promise.resolve(), database);
  if (!metadata) return { status: 'unavailable' };
  if (metadata.providers.length === 0) return { status: 'unknown' };
  // The item may have been completed by hand during the search.
  const current = await database.pendingItems.get(itemId);
  if (!current) return { status: 'unknown' };
  const bookId = await resolveItem(current, bookFieldsFromMetadata(metadata), current.shelfId, database);
  await completeFromMetadata(bookId, metadata, database);
  if ((await getSettings(database)).autoCovers) await attachAutoCover(bookId, metadata, database);
  return { status: 'found', bookId, title: metadata.title ?? '' };
}

/** Every unknown ISBN searched again (after a Google Books key is entered); returns how many were found. */
export async function retryAllUnknown(database: LibraryDatabase = db): Promise<{ found: number; unavailable: number }> {
  const items = await database.pendingItems.where('kind').equals('unknownIsbn').toArray();
  let found = 0;
  let unavailable = 0;
  for (const item of items) {
    const outcome = await retryItem(item.id, database);
    if (outcome.status === 'found') found += 1;
    if (outcome.status === 'unavailable') unavailable += 1;
  }
  return { found, unavailable };
}

/** Photograph taken on screen 4; replaces the previous one. */
export async function setItemPhoto(itemId: Id, photo: Blob, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.pendingItems, database.blobs, async () => {
    const item = await database.pendingItems.get(itemId);
    if (!item) return;
    if (item.photoBlobId) await database.blobs.delete(item.photoBlobId);
    const photoBlobId = newId();
    await database.blobs.add({ id: photoBlobId, blob: photo, createdAt: Date.now() });
    await database.pendingItems.update(itemId, { photoBlobId });
  });
}

/** Removes an item put aside by mistake (not a book, read twice), with its photograph. */
export async function deleteItem(itemId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.pendingItems, database.blobs, async () => {
    const item = await database.pendingItems.get(itemId);
    if (!item) return;
    if (item.photoBlobId) await database.blobs.delete(item.photoBlobId);
    await database.pendingItems.delete(itemId);
  });
}
