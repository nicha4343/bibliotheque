import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteBook, removeCopy } from '../books/books';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Copy, Loan, Shelf } from '../db/schema';
import { createRoom } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import {
  cancelLoan,
  classifyLendScan,
  dueDate,
  dueLoans,
  groupByBorrower,
  knownBorrowers,
  lendCopy,
  loadLendScan,
  loanHistory,
  loanState,
  matchBorrower,
  returnLoan,
  undoReturn,
} from './loans';

const loan = (fields: Partial<Loan>): Loan => ({
  id: newId(),
  copyId: 'c',
  borrower: 'Sam',
  lentAt: new Date(2026, 8, 1).getTime(),
  dueAt: new Date(2026, 9, 1, 12).getTime(),
  ...fields,
});

describe('échéance', () => {
  it('ajoute deux semaines, un mois ou deux mois', () => {
    const lent = new Date(2026, 10, 3, 18, 30);
    expect(dueDate(lent, '2w')).toEqual(new Date(2026, 10, 17, 12));
    expect(dueDate(lent, '1m')).toEqual(new Date(2026, 11, 3, 12));
    expect(dueDate(lent, '2m')).toEqual(new Date(2027, 0, 3, 12));
  });

  it('s’arrête au dernier jour d’un mois plus court', () => {
    expect(dueDate(new Date(2027, 0, 31), '1m')).toEqual(new Date(2027, 1, 28, 12));
    expect(dueDate(new Date(2026, 11, 31), '2m')).toEqual(new Date(2027, 1, 28, 12));
  });

  it('distingue un prêt en cours, arrivé à échéance aujourd’hui et en retard', () => {
    const current = loan({ dueAt: new Date(2026, 9, 1, 12).getTime() });
    expect(loanState(current, new Date(2026, 8, 30, 23, 59))).toBe('running');
    expect(loanState(current, new Date(2026, 9, 1, 0, 1))).toBe('due');
    expect(loanState(current, new Date(2026, 9, 1, 23, 59))).toBe('due');
    expect(loanState(current, new Date(2026, 9, 2, 8))).toBe('late');
  });

  it('retient les prêts en cours dont le jour de retour est venu', () => {
    const late = loan({ dueAt: new Date(2026, 9, 1, 12).getTime() });
    const running = loan({ dueAt: new Date(2026, 11, 1, 12).getTime() });
    const returned = loan({ returnedAt: new Date(2026, 9, 5).getTime() });
    expect(dueLoans([late, running, returned], new Date(2026, 10, 3))).toEqual([late]);
  });
});

describe('emprunteurs', () => {
  it('propose les noms déjà employés, le plus récent en tête, sans doublon', () => {
    const loans = [
      loan({ borrower: 'Sam', lentAt: 1 }),
      loan({ borrower: 'Léa', lentAt: 3 }),
      loan({ borrower: 'sam', lentAt: 2 }),
      loan({ borrower: 'Claire', lentAt: 0 }),
    ];
    expect(knownBorrowers(loans)).toEqual(['Léa', 'sam', 'Claire']);
  });

  it('reprend l’orthographe d’une personne déjà connue', () => {
    expect(matchBorrower('  lea ', ['Sam', 'Léa'])).toBe('Léa');
    expect(matchBorrower(' Jean   Dupont ', ['Sam'])).toBe('Jean Dupont');
  });

  it('regroupe les prêts par emprunteur, le retour le plus proche en tête', () => {
    const a = loan({ borrower: 'Sam', dueAt: 30 });
    const b = loan({ borrower: 'Léa', dueAt: 10 });
    const c = loan({ borrower: 'sam', dueAt: 20 });
    const done = loan({ borrower: 'Paul', dueAt: 5, returnedAt: 40 });
    expect(groupByBorrower([a, b, c, done])).toEqual([
      { borrower: 'Léa', loans: [b] },
      { borrower: 'sam', loans: [c, a] },
    ]);
  });

  it('classe l’historique par date de restitution', () => {
    const first = loan({ returnedAt: 10 });
    const second = loan({ returnedAt: 20 });
    expect(loanHistory([first, loan({}), second])).toEqual([second, first]);
  });
});

describe('lecture d’un code par le scan des prêts', () => {
  const book = newBook({ title: 'Candide', authors: ['Voltaire'] });
  const home: Copy = { id: 'home', bookId: book.id, shelfId: 's', addedAt: 2 };
  const lost: Copy = { id: 'lost', bookId: book.id, shelfId: 's', addedAt: 1, lostAt: 5 };
  const away: Copy = { id: 'away', bookId: book.id, shelfId: 's', addedAt: 0 };

  it('ignore un ouvrage absent de la bibliothèque', () => {
    expect(classifyLendScan(undefined, [], [])).toEqual({ kind: 'notOwned' });
    expect(classifyLendScan(book, [], [])).toEqual({ kind: 'notOwned' });
  });

  it('propose de prêter un exemplaire présent, de préférence à un exemplaire perdu', () => {
    expect(classifyLendScan(book, [lost, home], [loan({ copyId: 'x', returnedAt: 1 })])).toEqual({
      kind: 'lend',
      book,
      copies: [home, lost],
    });
  });

  it('enregistre la restitution du seul exemplaire, prêté', () => {
    const current = loan({ copyId: 'away' });
    expect(classifyLendScan(book, [away], [current])).toEqual({ kind: 'return', book, loan: current });
  });

  it('demande quoi faire s’il reste un exemplaire à prêter', () => {
    const current = loan({ copyId: 'away' });
    expect(classifyLendScan(book, [away, home], [current])).toEqual({ kind: 'choose', book, loans: [current], copies: [home] });
  });
});

describe('prêts enregistrés', () => {
  let database: LibraryDatabase;
  let shelf: Shelf;
  let book: Book;
  let copy: Copy;

  beforeEach(async () => {
    database = new LibraryDatabase(`test-${newId()}`);
    ({ shelf } = await createRoom('Salon', database));
    book = newBook({ isbn13: '9782070360420', title: 'La Peste', authors: ['Albert Camus'] });
    copy = newCopy(book.id, shelf.id);
    await database.books.add(book);
    await database.copies.add(copy);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('prête un exemplaire une seule fois, puis l’enregistre restitué', async () => {
    const now = new Date(2026, 10, 3, 10);
    const lent = await lendCopy(copy.id, ' Sam ', '2w', database, now);
    expect(lent).toMatchObject({ copyId: copy.id, borrower: 'Sam', lentAt: now.getTime(), dueAt: new Date(2026, 10, 17, 12).getTime() });
    expect(await lendCopy(copy.id, 'Léa', '1m', database, now)).toBeUndefined();
    expect(await loadLendScan('9782070360420', database)).toMatchObject({ kind: 'return', loan: { id: lent?.id } });

    const returned = await returnLoan(lent?.id ?? '', database, 1000);
    expect(returned?.returnedAt).toBe(1000);
    expect(await returnLoan(lent?.id ?? '', database)).toBeUndefined();
    expect(await loadLendScan('9782070360420', database)).toMatchObject({ kind: 'lend', copies: [{ id: copy.id }] });
  });

  it('reprend le nom d’un emprunteur connu et retrouve un exemplaire perdu', async () => {
    await database.loans.add(loan({ copyId: 'other', borrower: 'Léa', returnedAt: 1 }));
    await database.copies.update(copy.id, { lostAt: 5 });
    expect((await lendCopy(copy.id, 'lea', '1m', database))?.borrower).toBe('Léa');
    expect((await database.copies.get(copy.id))?.lostAt).toBeUndefined();
  });

  it('annule une restitution, sauf si l’exemplaire a été prêté de nouveau', async () => {
    const first = await lendCopy(copy.id, 'Sam', '1m', database);
    await returnLoan(first?.id ?? '', database);
    expect(await undoReturn(first?.id ?? '', database)).toBe(true);
    expect((await database.loans.get(first?.id ?? ''))?.returnedAt).toBeUndefined();

    await returnLoan(first?.id ?? '', database);
    const second = await lendCopy(copy.id, 'Léa', '1m', database);
    expect(await undoReturn(first?.id ?? '', database)).toBe(false);
    await cancelLoan(second?.id ?? '', database);
    expect(await database.loans.count()).toBe(1);
  });

  it('efface les prêts d’un exemplaire retiré ou d’un ouvrage supprimé', async () => {
    const other = newCopy(book.id, shelf.id);
    await database.copies.add(other);
    await lendCopy(other.id, 'Sam', '1m', database);
    await lendCopy(copy.id, 'Léa', '1m', database);
    expect(await removeCopy(other.id, database)).toBe(true);
    expect((await database.loans.toArray()).map((item) => item.borrower)).toEqual(['Léa']);
    await deleteBook(book.id, database);
    expect(await database.loans.count()).toBe(0);
  });
});
