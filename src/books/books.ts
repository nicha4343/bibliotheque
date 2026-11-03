import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Cover, CoverProvider, Id } from '../db/schema';
import { deleteLoansOf } from '../loans/loans';
import { bookshopCandidates, type CoverCandidate, type FoundCover } from '../metadata/covers';
import { openLibraryCoverUrl } from '../metadata/sources';
import { attachAutoCover } from '../scan/lookups';
import { newCopy } from '../scan/session';
import { deleteBookQuotes } from './quotes';

// Changes made on the book sheet (screen 6).

export type BookChanges = Partial<Pick<Book, 'title' | 'authors' | 'publisher' | 'year' | 'status' | 'rating' | 'review'>>;

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

/** « Autres couvertures disponibles »: those the sources gave, Open Library's by ISBN, then the booksellers'. */
export async function coverCandidates(book: Book, database: LibraryDatabase = db): Promise<CoverCandidate[]> {
  if (!book.isbn13) return [];
  const cached = await database.metadataCache.get(book.isbn13);
  const candidates: { provider: CoverProvider; url: string }[] = [...(cached?.payload.coverUrls ?? [])];
  const openLibrary = openLibraryCoverUrl(book.isbn13);
  if (!candidates.some((candidate) => candidate.url === openLibrary)) candidates.push({ provider: 'openLibrary', url: openLibrary });
  return [...candidates, ...bookshopCandidates(book.isbn13)];
}

export async function addCopy(bookId: Id, shelfId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.copies.add(newCopy(bookId, shelfId));
}

/**
 * Puts a copy on a shelf; a copy declared lost is thus found again. Its position on its former shelf
 * means nothing on the new one: it comes last there until the shelf is scanned again.
 */
export async function moveCopy(copyId: Id, shelfId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.copies, async () => {
    const copy = await database.copies.get(copyId);
    if (!copy) return;
    await database.copies.update(copyId, {
      shelfId,
      lostAt: undefined,
      position: copy.shelfId === shelfId ? copy.position : undefined,
    });
  });
}

/** Removes one copy and its loans; the last one goes only with its notice (deleteBook). */
export async function removeCopy(copyId: Id, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction('rw', database.copies, database.loans, async () => {
    const copy = await database.copies.get(copyId);
    if (!copy) return false;
    if ((await database.copies.where('bookId').equals(copy.bookId).count()) < 2) return false;
    await database.copies.delete(copyId);
    await deleteLoansOf([copyId], database);
    return true;
  });
}

/** « Supprimer de ma bibliothèque »: the notice, its copies and their loans, its cover and its quotes. */
export async function deleteBook(bookId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', [database.books, database.copies, database.loans, database.quotes, database.blobs], async () => {
    const book = await database.books.get(bookId);
    if (book?.cover?.blobId) await database.blobs.delete(book.cover.blobId);
    await deleteLoansOf(await database.copies.where('bookId').equals(bookId).primaryKeys(), database);
    await database.copies.where('bookId').equals(bookId).delete();
    await deleteBookQuotes(bookId, database);
    await database.books.delete(bookId);
  });
}
