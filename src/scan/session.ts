import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Copy, Id, PendingItem, ScanEntry, ScanSession, ScanSessionCounts } from '../db/schema';

/** The session left open (not ended), if any. */
export async function getActiveSession(database: LibraryDatabase = db): Promise<ScanSession | undefined> {
  const sessions = await database.scanSessions.orderBy('startedAt').reverse().toArray();
  return sessions.find((session) => session.endedAt === undefined);
}

/** Shelf of the latest session, to start the next one at the same place. */
export async function lastShelfId(database: LibraryDatabase = db): Promise<Id | undefined> {
  const session = await database.scanSessions.orderBy('startedAt').last();
  if (!session) return undefined;
  return (await database.shelves.get(session.shelfId)) ? session.shelfId : undefined;
}

export async function startSession(shelfId: Id, database: LibraryDatabase = db): Promise<ScanSession> {
  const session: ScanSession = {
    id: newId(),
    shelfId,
    startedAt: Date.now(),
    counts: { scanned: 0, added: 0, pending: 0, extraCopies: 0 },
  };
  await database.scanSessions.add(session);
  return session;
}

export async function setSessionShelf(sessionId: Id, shelfId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.scanSessions.update(sessionId, { shelfId });
}

/** A position is given only when the order on the shelf is remembered. */
export function newCopy(bookId: Id, shelfId: Id, position?: number): Copy {
  const copy: Copy = { id: newId(), bookId, shelfId, addedAt: Date.now() };
  if (position !== undefined) copy.position = position;
  return copy;
}

export interface ReadOptions {
  /** Position of the book on the shelf (« Mémoriser l’ordre sur l’étagère »): the time of the read. */
  position?: number | undefined;
}

export type IsbnOutcome = 'searching' | 'asking' | 'extraCopy';

/**
 * Records a read ISBN. An ISBN already in the library is answered at once, without network:
 * the « Ouvrage déjà possédé » dialog (asking) or, when that option is off, one more copy.
 */
export async function recordIsbn(
  session: ScanSession,
  isbn13: string,
  options: ReadOptions & { flagOwnedBooks: boolean },
  database: LibraryDatabase = db,
): Promise<ScanEntry> {
  return database.transaction('rw', [database.books, database.copies, database.scanEntries], async () => {
    const entry: ScanEntry = {
      id: newId(),
      sessionId: session.id,
      shelfId: session.shelfId,
      kind: 'isbn',
      isbn13,
      status: 'searching',
      createdAt: Date.now(),
    };
    if (options.position !== undefined) entry.position = options.position;
    const book = await database.books.where('isbn13').equals(isbn13).first();
    if (book) {
      entry.bookId = book.id;
      if (options.flagOwnedBooks) {
        entry.status = 'asking';
      } else {
        const copy = newCopy(book.id, session.shelfId, entry.position);
        await database.copies.add(copy);
        entry.status = 'extraCopy';
        entry.copyId = copy.id;
        entry.copyNumber = await database.copies.where('bookId').equals(book.id).count();
      }
    }
    await database.scanEntries.add(entry);
    return entry;
  });
}

/** « Sans code-barres »: the photograph goes to « À compléter ». */
export async function recordNoBarcode(
  session: ScanSession,
  photo: Blob,
  options: ReadOptions = {},
  database: LibraryDatabase = db,
): Promise<ScanEntry> {
  return database.transaction('rw', [database.blobs, database.pendingItems, database.scanEntries], async () => {
    const now = Date.now();
    const photoBlobId = newId();
    await database.blobs.add({ id: photoBlobId, blob: photo, createdAt: now });
    const item: PendingItem = {
      id: newId(),
      kind: 'noBarcode',
      photoBlobId,
      shelfId: session.shelfId,
      sessionId: session.id,
      createdAt: now,
    };
    if (options.position !== undefined) item.position = options.position;
    await database.pendingItems.add(item);
    const entry: ScanEntry = {
      id: newId(),
      sessionId: session.id,
      shelfId: session.shelfId,
      kind: 'noBarcode',
      status: 'pending',
      pendingItemId: item.id,
      createdAt: now,
    };
    await database.scanEntries.add(entry);
    return entry;
  });
}

/** The read waiting for an answer to « Ouvrage déjà possédé », oldest first. */
export async function nextQuestion(sessionId: Id, database: LibraryDatabase = db): Promise<ScanEntry | undefined> {
  const asking = await database.scanEntries.where('status').equals('asking').sortBy('createdAt');
  return asking.find((entry) => entry.sessionId === sessionId);
}

/** Explicit answer to « Ouvrage déjà possédé »; returns the number of the copy added, if any. */
export async function answerDuplicate(entryId: Id, addCopy: boolean, database: LibraryDatabase = db): Promise<number | undefined> {
  return database.transaction('rw', [database.copies, database.scanEntries], async () => {
    const entry = await database.scanEntries.get(entryId);
    if (entry?.status !== 'asking' || !entry.bookId) return undefined;
    if (!addCopy) {
      await database.scanEntries.update(entryId, { status: 'notAdded' });
      return undefined;
    }
    const copy = newCopy(entry.bookId, entry.shelfId, entry.position);
    await database.copies.add(copy);
    const copyNumber = await database.copies.where('bookId').equals(entry.bookId).count();
    await database.scanEntries.update(entryId, { status: 'extraCopy', copyId: copy.id, copyNumber });
    return copyNumber;
  });
}

/** Removes a read and whatever it created (copy, notice, item to complete). */
export async function deleteEntry(entry: ScanEntry, database: LibraryDatabase = db): Promise<void> {
  await database.transaction(
    'rw',
    [database.scanEntries, database.copies, database.books, database.pendingItems, database.blobs],
    async () => {
      if (entry.copyId) await database.copies.delete(entry.copyId);
      if (entry.createdBook && entry.bookId) {
        const remaining = await database.copies.where('bookId').equals(entry.bookId).count();
        if (remaining === 0) {
          const book = await database.books.get(entry.bookId);
          if (book?.cover?.blobId) await database.blobs.delete(book.cover.blobId);
          await database.books.delete(entry.bookId);
        }
      }
      if (entry.pendingItemId) {
        const item = await database.pendingItems.get(entry.pendingItemId);
        if (item?.photoBlobId) await database.blobs.delete(item.photoBlobId);
        await database.pendingItems.delete(entry.pendingItemId);
      }
      await database.scanEntries.delete(entry.id);
    },
  );
}

/** « Annuler la dernière lecture ». */
export async function undoLastEntry(sessionId: Id, database: LibraryDatabase = db): Promise<ScanEntry | undefined> {
  const entries = await database.scanEntries.where('sessionId').equals(sessionId).sortBy('createdAt');
  const last = entries.at(-1);
  if (last) await deleteEntry(last, database);
  return last;
}

export function countEntries(entries: readonly ScanEntry[]): ScanSessionCounts {
  return {
    scanned: entries.length,
    added: entries.filter((entry) => entry.status === 'added').length,
    pending: entries.filter((entry) => entry.status === 'pending').length,
    extraCopies: entries.filter((entry) => entry.status === 'extraCopy').length,
  };
}

/** « Terminer »: closes the session with its counts. Unanswered questions count as declined. */
export async function endSession(sessionId: Id, database: LibraryDatabase = db): Promise<ScanSession | undefined> {
  return database.transaction('rw', database.scanSessions, database.scanEntries, async () => {
    const session = await database.scanSessions.get(sessionId);
    if (!session) return undefined;
    await database.scanEntries
      .where('sessionId')
      .equals(sessionId)
      .and((entry) => entry.status === 'asking')
      .modify({ status: 'notAdded' });
    const entries = await database.scanEntries.where('sessionId').equals(sessionId).toArray();
    const ended: ScanSession = { ...session, endedAt: Date.now(), counts: countEntries(entries) };
    await database.scanSessions.put(ended);
    return ended;
  });
}

/** Notice created from a read once its metadata is known. */
export function newBook(fields: Pick<Book, 'title' | 'authors'> & Partial<Book>): Book {
  const now = Date.now();
  return { id: newId(), status: 'toread', rating: 0, review: '', tags: [], createdAt: now, updatedAt: now, ...fields };
}
