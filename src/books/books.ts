import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Cover, Id, MetadataProvider } from '../db/schema';
import { type FoundCover } from '../metadata/covers';
import { openLibraryCoverUrl } from '../metadata/sources';
import { attachAutoCover } from '../scan/lookups';
import { newCopy } from '../scan/session';

// Changes made on the book sheet (screen 6).

export type BookChanges = Partial<Pick<Book, 'title' | 'authors' | 'publisher' | 'year' | 'status'>>;

/** An empty optional field is removed from the notice. */
export async function updateBook(bookId: Id, changes: BookChanges, database: LibraryDatabase = db): Promise<void> {
  await database.books.update(bookId, { ...changes, updatedAt: Date.now() });
}

async function replaceCover(bookId: Id, cover: Cover | undefined, database: LibraryDatabase): Promise<void> {
  const book = await database.books.get(bookId);
  if (!book) return;
  const previous = book.cover?.blobId;
  if (previous && previous !== cover?.blobId) await database.blobs.delete(previous);
  await database.books.update(bookId, { cover, updatedAt: Date.now() });
}

/** Photograph or gallery image of the user: always wins over automatic covers. */
export async function setUserCover(bookId: Id, image: Blob, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.books, database.blobs, async () => {
    const blobId = newId();
    await database.blobs.add({ id: blobId, blob: image, createdAt: Date.now() });
    await replaceCover(bookId, { source: 'user', blobId }, database);
  });
}

/** Another automatic cover chosen among those available. */
export async function setAutoCover(bookId: Id, found: FoundCover, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.books, database.blobs, async () => {
    const cover: Cover = { source: 'auto', url: found.url, provider: found.provider };
    if (found.blob) {
      cover.blobId = newId();
      await database.blobs.add({ id: cover.blobId, blob: found.blob, createdAt: Date.now() });
    }
    await replaceCover(bookId, cover, database);
  });
}

/** « Rétablir la couverture automatique »: the photograph is removed, then a cover is searched again. */
export async function restoreAutoCover(bookId: Id, database: LibraryDatabase = db): Promise<boolean> {
  await database.transaction('rw', database.books, database.blobs, () => replaceCover(bookId, undefined, database));
  const book = await database.books.get(bookId);
  if (!book?.isbn13) return false;
  const cached = await database.metadataCache.get(book.isbn13);
  await attachAutoCover(bookId, cached?.payload ?? { isbn13: book.isbn13, providers: [] }, database);
  return Boolean((await database.books.get(bookId))?.cover);
}

/** « Autres couvertures disponibles »: those the sources gave, and Open Library's by ISBN. */
export async function coverCandidates(
  book: Book,
  database: LibraryDatabase = db,
): Promise<{ provider: MetadataProvider; url: string }[]> {
  if (!book.isbn13) return [];
  const cached = await database.metadataCache.get(book.isbn13);
  const candidates = [...(cached?.payload.coverUrls ?? [])];
  const openLibrary = openLibraryCoverUrl(book.isbn13);
  if (!candidates.some((candidate) => candidate.url === openLibrary)) candidates.push({ provider: 'openLibrary', url: openLibrary });
  return candidates;
}

export async function addCopy(bookId: Id, shelfId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.copies.add(newCopy(bookId, shelfId));
}

export async function moveCopy(copyId: Id, shelfId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.copies.update(copyId, { shelfId });
}

/** Removes one copy; the last one goes only with its notice (deleteBook). */
export async function removeCopy(copyId: Id, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction('rw', database.copies, async () => {
    const copy = await database.copies.get(copyId);
    if (!copy) return false;
    if ((await database.copies.where('bookId').equals(copy.bookId).count()) < 2) return false;
    await database.copies.delete(copyId);
    return true;
  });
}

/** « Supprimer de ma bibliothèque »: the notice, its copies and its cover. */
export async function deleteBook(bookId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', [database.books, database.copies, database.blobs], async () => {
    const book = await database.books.get(bookId);
    if (book?.cover?.blobId) await database.blobs.delete(book.cover.blobId);
    await database.copies.where('bookId').equals(bookId).delete();
    await database.books.delete(bookId);
  });
}
