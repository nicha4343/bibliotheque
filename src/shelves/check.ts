import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, CheckAnswer, CheckRead, Copy, Id, ShelfCheck, ShelfCheckResult } from '../db/schema';
import { getSettings } from '../db/settings';
import { wakeLookups } from '../scan/lookups';
import { endSession, newCopy, recordIsbn, startSession } from '../scan/session';
import { positionsAfterCheck, sortByPosition } from './order';

// « Vérifier cette étagère » (screen 8): the shelf is scanned again, then compared with the library.
// Nothing changes in the library before the user answers, except the order of the shelf (when it is
// remembered) and the copies declared lost that turn out to be there.

/** Notices of the codes read and of the shelf's copies, with all their copies. */
export interface CheckLibrary {
  shelfId: Id;
  books: readonly Book[];
  copies: readonly Copy[];
  /** Copies currently lent (lot 4): their absence is expected. */
  lentCopyIds: ReadonlySet<Id>;
}

export type ReadVerdict =
  | { kind: 'inPlace'; book: Book; copy: Copy }
  /** The copy is kept on another shelf (copy.shelfId). */
  | { kind: 'misplaced'; book: Book; copy: Copy }
  /** Not in the library, or a notice without any copy. */
  | { kind: 'notOwned'; book?: Book }
  /** Every copy of this book was already read during the check. */
  | { kind: 'repeated'; book?: Book };

/** Copies the check expects on the shelf: those declared lost are not. */
export const expectedCopies = (library: CheckLibrary): Copy[] =>
  library.copies.filter((copy) => copy.shelfId === library.shelfId && copy.lostAt === undefined);

/** What each read means, in the order of reading; each read takes one copy, those of the shelf first. */
export function judgeReads(reads: readonly CheckRead[], library: CheckLibrary): ReadVerdict[] {
  const byIsbn = new Map<string, Book>();
  for (const book of library.books) if (book.isbn13) byIsbn.set(book.isbn13, book);
  const copiesByBook = new Map<Id, Copy[]>();
  for (const copy of sortByPosition(library.copies)) copiesByBook.set(copy.bookId, [...(copiesByBook.get(copy.bookId) ?? []), copy]);
  const taken = new Set<Id>();
  const seenNotOwned = new Set<string>();
  // A copy declared lost comes after the others: it is less likely to be the one in hand.
  const pick = (copies: Copy[]) => copies.find((copy) => copy.lostAt === undefined) ?? copies[0];

  return reads.map((read): ReadVerdict => {
    const book = byIsbn.get(read.isbn13);
    const copies = book ? (copiesByBook.get(book.id) ?? []) : [];
    if (!book || copies.length === 0) {
      if (seenNotOwned.has(read.isbn13)) return book ? { kind: 'repeated', book } : { kind: 'repeated' };
      seenNotOwned.add(read.isbn13);
      return book ? { kind: 'notOwned', book } : { kind: 'notOwned' };
    }
    const free = copies.filter((copy) => !taken.has(copy.id));
    const here = pick(free.filter((copy) => copy.shelfId === library.shelfId));
    if (here) {
      taken.add(here.id);
      return { kind: 'inPlace', book, copy: here };
    }
    // Read twice rather than a second copy out of place: the commoner mistake.
    const elsewhere = copies.some((copy) => copy.shelfId === library.shelfId) ? undefined : pick(free);
    if (!elsewhere) return { kind: 'repeated', book };
    taken.add(elsewhere.id);
    return { kind: 'misplaced', book, copy: elsewhere };
  });
}

/** Position on the shelf of the copy each read stands for: the order of reading, from 1. */
const readPosition = (index: number) => index + 1;

export function compareShelf(reads: readonly CheckRead[], verdicts: readonly ReadVerdict[], library: CheckLibrary): ShelfCheckResult {
  const result: ShelfCheckResult = { inPlace: [], missing: [], lent: [], misplaced: [], notOwned: [], unchecked: [] };
  verdicts.forEach((verdict, index) => {
    const position = readPosition(index);
    if (verdict.kind === 'inPlace') result.inPlace.push(verdict.copy.id);
    else if (verdict.kind === 'misplaced') result.misplaced.push({ copyId: verdict.copy.id, shelfId: verdict.copy.shelfId, position });
    else if (verdict.kind === 'notOwned') {
      const isbn13 = reads[index]?.isbn13 ?? '';
      result.notOwned.push(verdict.book ? { isbn13, bookId: verdict.book.id, position } : { isbn13, position });
    }
  });
  const read = new Set(result.inPlace);
  const books = new Map(library.books.map((book) => [book.id, book]));
  for (const copy of sortByPosition(expectedCopies(library))) {
    if (read.has(copy.id)) continue;
    if (!books.get(copy.bookId)?.isbn13) result.unchecked.push(copy.id);
    else if (library.lentCopyIds.has(copy.id)) result.lent.push(copy.id);
    else result.missing.push(copy.id);
  }
  return result;
}

/** New positions of the shelf's copies once the check ends, when the order is remembered. */
export function checkPositions(verdicts: readonly ReadVerdict[], library: CheckLibrary): Map<Id, number> {
  const read = new Map<Id, number>();
  verdicts.forEach((verdict, index) => {
    if (verdict.kind === 'inPlace') read.set(verdict.copy.id, readPosition(index));
  });
  const shelf = library.copies.filter((copy) => copy.shelfId === library.shelfId && (copy.lostAt === undefined || read.has(copy.id)));
  return positionsAfterCheck(shelf, read);
}

export interface CheckProgress {
  /** Copies of the shelf read so far, out of those a scan can check. */
  found: number;
  expected: number;
  /** Reads to look at once the check ends (out of place, not in the library). */
  toReview: number;
}

export function checkProgress(verdicts: readonly ReadVerdict[], library: CheckLibrary): CheckProgress {
  const books = new Map(library.books.map((book) => [book.id, book]));
  const expected = new Set(expectedCopies(library).filter((copy) => books.get(copy.bookId)?.isbn13).map((copy) => copy.id));
  return {
    found: verdicts.filter((verdict) => verdict.kind === 'inPlace' && expected.has(verdict.copy.id)).length,
    expected: expected.size,
    toReview: verdicts.filter((verdict) => verdict.kind === 'misplaced' || verdict.kind === 'notOwned').length,
  };
}

export async function loadCheckLibrary(shelfId: Id, isbns: readonly string[], database: LibraryDatabase = db): Promise<CheckLibrary> {
  const shelfCopies = await database.copies.where('shelfId').equals(shelfId).toArray();
  const readBooks = isbns.length > 0 ? await database.books.where('isbn13').anyOf([...new Set(isbns)]).toArray() : [];
  const readCopies =
    readBooks.length > 0 ? await database.copies.where('bookId').anyOf(readBooks.map((book) => book.id)).toArray() : [];
  const known = new Set(readBooks.map((book) => book.id));
  const shelfBookIds = [...new Set(shelfCopies.map((copy) => copy.bookId))].filter((id) => !known.has(id));
  const shelfBooks = (await database.books.bulkGet(shelfBookIds)).filter((book): book is Book => book !== undefined);
  const copies = new Map([...shelfCopies, ...readCopies].map((copy) => [copy.id, copy]));
  const loans = shelfCopies.length > 0 ? await database.loans.where('copyId').anyOf(shelfCopies.map((copy) => copy.id)).toArray() : [];
  return {
    shelfId,
    books: [...readBooks, ...shelfBooks],
    copies: [...copies.values()],
    lentCopyIds: new Set(loans.filter((loan) => loan.returnedAt === undefined).map((loan) => loan.copyId)),
  };
}

/** The check of this shelf left unfinished (application closed meanwhile), if any. */
export async function findOpenCheck(shelfId: Id, database: LibraryDatabase = db): Promise<ShelfCheck | undefined> {
  const checks = await database.shelfChecks.where('shelfId').equals(shelfId).toArray();
  return checks.find((check) => check.endedAt === undefined);
}

/** The last check of the shelf, finished or not. */
export async function latestCheck(shelfId: Id, database: LibraryDatabase = db): Promise<ShelfCheck | undefined> {
  const checks = await database.shelfChecks.where('shelfId').equals(shelfId).sortBy('startedAt');
  return checks.at(-1);
}

/** Resumes the unfinished check of the shelf, or starts one. */
export async function openCheck(shelfId: Id, database: LibraryDatabase = db): Promise<ShelfCheck> {
  return database.transaction('rw', database.shelfChecks, async () => {
    const open = await findOpenCheck(shelfId, database);
    if (open) return open;
    const check: ShelfCheck = { id: newId(), shelfId, startedAt: Date.now(), reads: [] };
    await database.shelfChecks.add(check);
    return check;
  });
}

async function changeReads(
  checkId: Id,
  change: (reads: CheckRead[]) => CheckRead[],
  database: LibraryDatabase,
): Promise<void> {
  await database.transaction('rw', database.shelfChecks, async () => {
    const check = await database.shelfChecks.get(checkId);
    if (!check || check.endedAt !== undefined) return;
    await database.shelfChecks.update(checkId, { reads: change(check.reads) });
  });
}

export async function addCheckRead(checkId: Id, isbn13: string, database: LibraryDatabase = db): Promise<void> {
  await changeReads(checkId, (reads) => [...reads, { isbn13, at: Date.now() }], database);
}

/** Removes one read (the cross of its row), or the last one (« Annuler la dernière lecture »). */
export async function removeCheckRead(checkId: Id, index?: number, database: LibraryDatabase = db): Promise<void> {
  await changeReads(checkId, (reads) => reads.filter((_, i) => i !== (index ?? reads.length - 1)), database);
}

/** « Abandonner »: the reads are forgotten, the library is unchanged. */
export async function cancelCheck(checkId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.shelfChecks, async () => {
    const check = await database.shelfChecks.get(checkId);
    if (check?.endedAt === undefined) await database.shelfChecks.delete(checkId);
  });
}

/**
 * « Terminer »: compares the reads with the library and keeps the result, which replaces the previous
 * check of the shelf. When the order is remembered, the shelf takes the order of the reads.
 */
export async function endCheck(checkId: Id, database: LibraryDatabase = db): Promise<ShelfCheck | undefined> {
  const { rememberShelfOrder } = await getSettings(database);
  return database.transaction('rw', [database.shelfChecks, database.books, database.copies, database.loans], async () => {
    const check = await database.shelfChecks.get(checkId);
    if (!check || check.endedAt !== undefined) return check;
    const library = await loadCheckLibrary(check.shelfId, check.reads.map((read) => read.isbn13), database);
    const verdicts = judgeReads(check.reads, library);
    const result = compareShelf(check.reads, verdicts, library);
    // A copy declared lost and read again has been found.
    const seen = new Set([...result.inPlace, ...result.misplaced.map((item) => item.copyId)]);
    for (const copy of library.copies) {
      if (copy.lostAt !== undefined && seen.has(copy.id)) await database.copies.update(copy.id, { lostAt: undefined });
    }
    if (rememberShelfOrder) {
      for (const [copyId, position] of checkPositions(verdicts, library)) await database.copies.update(copyId, { position });
    }
    await database.shelfChecks.where('shelfId').equals(check.shelfId).and((other) => other.id !== checkId).delete();
    const ended: ShelfCheck = { ...check, endedAt: Date.now(), result, answers: {} };
    await database.shelfChecks.put(ended);
    return ended;
  });
}

/** Hides the result from the shelf view. */
export async function dismissCheck(checkId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.shelfChecks.update(checkId, { dismissed: true });
}

/**
 * Answer to one result: the copy (or ISBN) it concerns is changed accordingly, and the answer is kept
 * so that the result shows it. Returns false when the result no longer exists.
 */
export async function answerCheck(checkId: Id, key: string, answer: CheckAnswer, database: LibraryDatabase = db): Promise<boolean> {
  const { rememberShelfOrder } = await getSettings(database);
  // 'search': a book not in the library was added, its metadata remain to be searched.
  const outcome = await database.transaction(
    'rw',
    [database.shelfChecks, database.books, database.copies, database.scanSessions, database.scanEntries],
    async () => {
      const check = await database.shelfChecks.get(checkId);
      const result = check?.result;
      if (!check || !result || check.answers?.[key]) return 'failed';
      switch (answer.kind) {
        case 'movedHere': {
          const item = result.misplaced.find((misplaced) => misplaced.copyId === key);
          if (!item) return 'failed';
          await database.copies.update(key, {
            shelfId: check.shelfId,
            lostAt: undefined,
            position: rememberShelfOrder ? item.position : undefined,
          });
          break;
        }
        case 'toPutBack':
          break;
        case 'movedTo':
          await database.copies.update(key, { shelfId: answer.shelfId, lostAt: undefined, position: undefined });
          break;
        case 'lost':
          await database.copies.update(key, { lostAt: Date.now() });
          break;
        case 'added': {
          const item = result.notOwned.find((notOwned) => notOwned.isbn13 === key);
          if (!item) return 'failed';
          const position = rememberShelfOrder ? item.position : undefined;
          await database.shelfChecks.update(checkId, { answers: { ...check.answers, [key]: answer } });
          if (item.bookId && (await database.books.get(item.bookId))) {
            await database.copies.add(newCopy(item.bookId, check.shelfId, position));
            return 'done';
          }
          // Searched and added as by a scan: unknown everywhere, it goes to « À compléter ».
          const session = await startSession(check.shelfId, database);
          await recordIsbn(session, key, { flagOwnedBooks: false, position }, database);
          await endSession(session.id, database);
          return 'search';
        }
      }
      await database.shelfChecks.update(checkId, { answers: { ...check.answers, [key]: answer } });
      return 'done';
    },
  );
  if (outcome === 'search') wakeLookups(database);
  return outcome !== 'failed';
}
