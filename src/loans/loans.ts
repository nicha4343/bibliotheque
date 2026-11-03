import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Copy, Id, Loan } from '../db/schema';
import { foldText } from '../library/filter';
import { dueDate, isActive, unseenDueLoans, type LoanDuration } from './dates';

// Loans (lot 4, screen 10): lend a copy, give it back, remind the borrower.

export * from './dates';

/** Names already used, the person most recently lent to first. */
export function knownBorrowers(loans: readonly Loan[]): string[] {
  const names = new Map<string, string>();
  for (const loan of [...loans].sort((a, b) => b.lentAt - a.lentAt)) {
    const key = foldText(loan.borrower);
    if (!names.has(key)) names.set(key, loan.borrower);
  }
  return [...names.values()];
}

/** « sam » typed for a new person is the « Sam » already known: the same person keeps one spelling. */
export function matchBorrower(name: string, known: readonly string[]): string {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  return known.find((existing) => foldText(existing) === foldText(cleaned)) ?? cleaned;
}

/**
 * Lends a copy; undefined if it is lent already or no longer exists. The book is in hand: a copy
 * declared lost is found again.
 */
export async function lendCopy(
  copyId: Id,
  borrower: string,
  duration: LoanDuration,
  database: LibraryDatabase = db,
  now = new Date(),
): Promise<Loan | undefined> {
  return database.transaction('rw', database.copies, database.loans, async () => {
    const copy = await database.copies.get(copyId);
    if (!copy) return undefined;
    if ((await database.loans.where('copyId').equals(copyId).toArray()).some(isActive)) return undefined;
    const known = (await database.loans.orderBy('borrower').uniqueKeys()).map(String);
    const name = matchBorrower(borrower, known);
    if (!name) return undefined;
    const loan: Loan = { id: newId(), copyId, borrower: name, lentAt: now.getTime(), dueAt: dueDate(now, duration).getTime() };
    await database.loans.add(loan);
    if (copy.lostAt !== undefined) await database.copies.update(copyId, { lostAt: undefined });
    return loan;
  });
}

/** « Restitué »: the loan goes to the history. */
export async function returnLoan(loanId: Id, database: LibraryDatabase = db, now = Date.now()): Promise<Loan | undefined> {
  return database.transaction('rw', database.loans, async () => {
    const loan = await database.loans.get(loanId);
    if (!loan || !isActive(loan)) return undefined;
    await database.loans.update(loanId, { returnedAt: now });
    return { ...loan, returnedAt: now };
  });
}

/** « Annuler » after a return: the copy is lent again, unless it has been lent meanwhile. */
export async function undoReturn(loanId: Id, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction('rw', database.loans, async () => {
    const loan = await database.loans.get(loanId);
    if (!loan || isActive(loan)) return false;
    if ((await database.loans.where('copyId').equals(loan.copyId).toArray()).some(isActive)) return false;
    await database.loans.update(loanId, { returnedAt: undefined });
    return true;
  });
}

/** A loan recorded by mistake, cancelled from the lending scan: it leaves no history. */
export async function cancelLoan(loanId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.loans.delete(loanId);
}

/** The loans of copies being removed go with them, their history included. Call inside a transaction on loans. */
export async function deleteLoansOf(copyIds: readonly Id[], database: LibraryDatabase = db): Promise<void> {
  if (copyIds.length > 0) await database.loans.where('copyId').anyOf([...copyIds]).delete();
}

/** What a code read by the lending scan means. */
export type LendScan =
  | { kind: 'notOwned' }
  /** Copies that may be lent, the best first (on their shelf, then the oldest). */
  | { kind: 'lend'; book: Book; copies: Copy[] }
  /** The only copy is lent: reading it again means it is back. */
  | { kind: 'return'; book: Book; loan: Loan }
  /** Several loans, or a loan and a copy at home: the user says which. */
  | { kind: 'choose'; book: Book; loans: Loan[]; copies: Copy[] };

export function classifyLendScan(book: Book | undefined, copies: readonly Copy[], loans: readonly Loan[]): LendScan {
  if (!book || copies.length === 0) return { kind: 'notOwned' };
  const active = loans.filter(isActive).sort((a, b) => a.lentAt - b.lentAt);
  const lentIds = new Set(active.map((loan) => loan.copyId));
  const available = copies
    .filter((copy) => !lentIds.has(copy.id))
    .sort((a, b) => Number(a.lostAt !== undefined) - Number(b.lostAt !== undefined) || a.addedAt - b.addedAt);
  const [onlyLoan] = active;
  if (!onlyLoan) return { kind: 'lend', book, copies: available };
  if (active.length === 1 && available.length === 0) return { kind: 'return', book, loan: onlyLoan };
  return { kind: 'choose', book, loans: active, copies: available };
}

export async function loadLendScan(isbn13: string, database: LibraryDatabase = db): Promise<LendScan> {
  const book = await database.books.where('isbn13').equals(isbn13).first();
  if (!book) return { kind: 'notOwned' };
  const copies = await database.copies.where('bookId').equals(book.id).toArray();
  const loans = copies.length > 0 ? await database.loans.where('copyId').anyOf(copies.map((copy) => copy.id)).toArray() : [];
  return classifyLendScan(book, copies, loans);
}

/** Loans in progress grouped by borrower: the most urgent return first, in each group and between groups. */
export interface BorrowerGroup {
  borrower: string;
  loans: Loan[];
}

export function groupByBorrower(loans: readonly Loan[]): BorrowerGroup[] {
  const groups = new Map<string, BorrowerGroup>();
  for (const loan of [...loans].filter(isActive).sort((a, b) => a.dueAt - b.dueAt || a.lentAt - b.lentAt)) {
    const key = foldText(loan.borrower);
    const group = groups.get(key);
    if (group) group.loans.push(loan);
    else groups.set(key, { borrower: loan.borrower, loans: [loan] });
  }
  return [...groups.values()];
}

/** Returned loans, the most recent return first. */
export const loanHistory = (loans: readonly Loan[]): Loan[] =>
  loans.filter((loan) => !isActive(loan)).sort((a, b) => (b.returnedAt ?? 0) - (a.returnedAt ?? 0));

/** The reminder of the library screen is closed, or the loans screen opened: the due loans have been seen. */
export async function markDueLoansSeen(database: LibraryDatabase = db, now = new Date()): Promise<void> {
  const unseen = unseenDueLoans(await database.loans.toArray(), now);
  if (unseen.length > 0) await database.loans.bulkUpdate(unseen.map((loan) => ({ key: loan.id, changes: { seenAt: now.getTime() } })));
}
