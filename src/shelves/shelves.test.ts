import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { moveCopy } from '../books/books';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, CheckRead, Copy, Shelf } from '../db/schema';
import { updateSettings } from '../db/settings';
import { createRoom, createShelf, deleteShelfIfEmpty } from '../places/places';
import { newBook, newCopy, recordIsbn, startSession } from '../scan/session';
import {
  answerCheck,
  checkPositions,
  checkProgress,
  compareShelf,
  endCheck,
  judgeReads,
  addCheckRead,
  openCheck,
  removeCheckRead,
  cancelCheck,
  type CheckLibrary,
} from './check';
import { positionsAfterCheck, rankOf, sortByPosition } from './order';

const copy = (id: string, fields: Partial<Copy> = {}): Copy => ({ id, bookId: `b-${id}`, shelfId: 'here', addedAt: 0, ...fields });

describe('ordre sur l’étagère', () => {
  it('place les positions connues de gauche à droite, puis les autres par date d’ajout', () => {
    const copies = [copy('c', { addedAt: 2 }), copy('b', { position: 20 }), copy('d', { addedAt: 1 }), copy('a', { position: 10 })];
    expect(sortByPosition(copies).map((c) => c.id)).toEqual(['a', 'b', 'd', 'c']);
    expect([...rankOf(copies)]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('garde sa place, après l’ouvrage qui le précédait, à un ouvrage absent lors de la vérification', () => {
    // Before: A B C D E; read: C A E. B followed A and D followed C: they keep those places.
    const shelf = ['A', 'B', 'C', 'D', 'E'].map((id, index) => copy(id, { position: index + 1 }));
    const read = new Map([
      ['C', 1],
      ['A', 2],
      ['E', 3],
    ]);
    const positions = positionsAfterCheck(shelf, read);
    const order = [...positions].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(order).toEqual(['C', 'D', 'A', 'B', 'E']);
  });

  it('place en tête les absents qui précédaient tout ouvrage lu, et laisse sans position ceux qui n’en avaient pas', () => {
    const shelf = [copy('A', { position: 1 }), copy('B', { position: 2 }), copy('C', { position: 3 }), copy('N')];
    const positions = positionsAfterCheck(shelf, new Map([['C', 1]]));
    const order = [...positions].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(order).toEqual(['A', 'B', 'C']);
    expect(positions.has('N')).toBe(false);
  });
});

const book = (id: string, isbn13?: string): Book => ({
  ...newBook({ title: `Livre ${id}`, authors: [] }),
  id,
  ...(isbn13 ? { isbn13 } : {}),
});

const reads = (...isbns: string[]): CheckRead[] => isbns.map((isbn13, index) => ({ isbn13, at: index }));

describe('comparaison d’une étagère', () => {
  // Here: P (978…01), Q (…02, lent), R (…03), S (no ISBN), L (…05, declared lost). Elsewhere: M (…04).
  const library: CheckLibrary = {
    shelfId: 'here',
    books: [book('P', '01'), book('Q', '02'), book('R', '03'), book('S'), book('M', '04'), book('L', '05')],
    copies: [
      { id: 'p', bookId: 'P', shelfId: 'here', addedAt: 1, position: 1 },
      { id: 'q', bookId: 'Q', shelfId: 'here', addedAt: 2, position: 2 },
      { id: 'r', bookId: 'R', shelfId: 'here', addedAt: 3, position: 3 },
      { id: 's', bookId: 'S', shelfId: 'here', addedAt: 4, position: 4 },
      { id: 'm', bookId: 'M', shelfId: 'there', addedAt: 5 },
      { id: 'l', bookId: 'L', shelfId: 'here', addedAt: 6, lostAt: 7 },
    ],
    lentCopyIds: new Set(['q']),
  };

  it('distingue les ouvrages à leur place, mal rangés, inconnus et lus deux fois', () => {
    const verdicts = judgeReads(reads('01', '04', '99', '01', '99', '05'), library);
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(['inPlace', 'misplaced', 'notOwned', 'repeated', 'repeated', 'inPlace']);
  });

  it('signale les absents, sauf ceux qui sont prêtés, et ceux qu’un scan ne peut vérifier', () => {
    const read = reads('01', '04', '99');
    const result = compareShelf(read, judgeReads(read, library), library);
    expect(result).toEqual({
      inPlace: ['p'],
      missing: ['r'],
      lent: ['q'],
      misplaced: [{ copyId: 'm', shelfId: 'there', position: 2 }],
      notOwned: [{ isbn13: '99', position: 3 }],
      unchecked: ['s'],
    });
    expect(checkProgress(judgeReads(read, library), library)).toEqual({ found: 1, expected: 3, toReview: 2 });
  });

  it('retient l’ordre des lectures, un ouvrage déclaré perdu retrouvé compris', () => {
    const read = reads('05', '03', '01');
    const positions = checkPositions(judgeReads(read, library), library);
    const order = [...positions].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    // Q (lent) and S (no barcode) follow R and P, as before.
    expect(order).toEqual(['l', 'r', 's', 'p', 'q']);
  });

  it('prend chaque exemplaire une seule fois, ceux de l’étagère d’abord', () => {
    const twice: CheckLibrary = {
      shelfId: 'here',
      books: [book('T', '10')],
      copies: [
        { id: 't1', bookId: 'T', shelfId: 'there', addedAt: 1 },
        { id: 't2', bookId: 'T', shelfId: 'here', addedAt: 2 },
      ],
      lentCopyIds: new Set(),
    };
    const verdicts = judgeReads(reads('10', '10'), twice);
    expect(verdicts.map((verdict) => (verdict.kind === 'inPlace' ? verdict.copy.id : verdict.kind))).toEqual(['t2', 'repeated']);
  });
});

describe('vérification enregistrée', () => {
  let database: LibraryDatabase;
  let shelf: Shelf;
  let other: Shelf;
  let books: Book[];

  beforeEach(async () => {
    database = new LibraryDatabase(`test-${newId()}`);
    ({ shelf } = await createRoom('Salon', database));
    other = await createShelf(shelf.roomId, undefined, database);
    books = ['9782070360420', '9782070360024', '9782070413119', '9782253004227'].map((isbn13, index) =>
      newBook({ isbn13, title: `Livre ${index}`, authors: [] }),
    );
    await database.books.bulkAdd(books);
    // Three on the shelf, the fourth elsewhere.
    await database.copies.bulkAdd([
      newCopy(books[0]?.id ?? '', shelf.id, 1),
      newCopy(books[1]?.id ?? '', shelf.id, 2),
      newCopy(books[2]?.id ?? '', shelf.id, 3),
      newCopy(books[3]?.id ?? '', other.id),
    ]);
  });

  afterEach(async () => {
    await database.delete();
  });

  const copyOf = async (index: number) => database.copies.where('bookId').equals(books[index]?.id ?? '').first();

  it('reprend la vérification laissée en cours, et l’oublie quand elle est abandonnée', async () => {
    const check = await openCheck(shelf.id, database);
    await addCheckRead(check.id, '9782070360420', database);
    await addCheckRead(check.id, '9782070360024', database);
    await removeCheckRead(check.id, undefined, database);
    expect((await openCheck(shelf.id, database)).id).toBe(check.id);
    expect((await database.shelfChecks.get(check.id))?.reads.map((read) => read.isbn13)).toEqual(['9782070360420']);
    await cancelCheck(check.id, database);
    expect(await database.shelfChecks.count()).toBe(0);
  });

  it('enregistre l’ordre lu quand l’option est active, sans rien changer d’autre', async () => {
    await updateSettings({ rememberShelfOrder: true }, database);
    const check = await openCheck(shelf.id, database);
    for (const isbn of ['9782070413119', '9782253004227', '9782070360420']) await addCheckRead(check.id, isbn, database);
    const ended = await endCheck(check.id, database);
    expect(ended?.result?.missing).toEqual([(await copyOf(1))?.id]);
    expect(ended?.result?.misplaced.map((item) => item.copyId)).toEqual([(await copyOf(3))?.id]);
    const onShelf = sortByPosition(await database.copies.where('shelfId').equals(shelf.id).toArray());
    expect(onShelf.map((c) => c.bookId)).toEqual([books[2]?.id, books[0]?.id, books[1]?.id]);
    expect((await copyOf(3))?.shelfId).toBe(other.id);
  });

  it('ne touche pas à l’ordre quand l’option est désactivée', async () => {
    const check = await openCheck(shelf.id, database);
    await addCheckRead(check.id, '9782070413119', database);
    await endCheck(check.id, database);
    expect((await copyOf(2))?.position).toBe(3);
  });

  it('applique les réponses : ranger ici, déclarer perdu, ranger ailleurs', async () => {
    await updateSettings({ rememberShelfOrder: true }, database);
    const check = await openCheck(shelf.id, database);
    for (const isbn of ['9782070360420', '9782253004227']) await addCheckRead(check.id, isbn, database);
    await endCheck(check.id, database);
    const misplaced = (await copyOf(3))?.id ?? '';
    const [missing1, missing2] = [(await copyOf(1))?.id ?? '', (await copyOf(2))?.id ?? ''];

    expect(await answerCheck(check.id, misplaced, { kind: 'movedHere' }, database)).toBe(true);
    expect(await database.copies.get(misplaced)).toMatchObject({ shelfId: shelf.id, position: 2 });
    expect(await answerCheck(check.id, missing1, { kind: 'lost' }, database)).toBe(true);
    expect((await database.copies.get(missing1))?.lostAt).toBeTypeOf('number');
    expect(await answerCheck(check.id, missing2, { kind: 'movedTo', shelfId: other.id }, database)).toBe(true);
    const moved = await database.copies.get(missing2);
    expect(moved?.shelfId).toBe(other.id);
    expect(moved?.position).toBeUndefined();
    // A second answer to the same result is refused.
    expect(await answerCheck(check.id, missing1, { kind: 'movedTo', shelfId: other.id }, database)).toBe(false);
    expect((await database.shelfChecks.get(check.id))?.answers).toEqual({
      [misplaced]: { kind: 'movedHere' },
      [missing1]: { kind: 'lost' },
      [missing2]: { kind: 'movedTo', shelfId: other.id },
    });
  });

  it('retrouve un exemplaire déclaré perdu lu sur l’étagère, et le retire du bilan suivant', async () => {
    const lost = (await copyOf(0))?.id ?? '';
    await database.copies.update(lost, { lostAt: 1 });
    const check = await openCheck(shelf.id, database);
    await addCheckRead(check.id, '9782070360420', database);
    const ended = await endCheck(check.id, database);
    expect(ended?.result?.inPlace).toEqual([lost]);
    expect((await database.copies.get(lost))?.lostAt).toBeUndefined();
  });

  it('ajoute à l’étagère un ouvrage absent de la bibliothèque, comme le ferait un scan', async () => {
    const check = await openCheck(shelf.id, database);
    await addCheckRead(check.id, '9782253006306', database);
    await endCheck(check.id, database);
    expect(await answerCheck(check.id, '9782253006306', { kind: 'added' }, database)).toBe(true);
    const entry = await database.scanEntries.where('status').equals('searching').first();
    expect(entry).toMatchObject({ isbn13: '9782253006306', shelfId: shelf.id });
  });

  it('remplace la vérification précédente et disparaît avec l’étagère', async () => {
    const first = await openCheck(other.id, database);
    await endCheck(first.id, database);
    const second = await openCheck(other.id, database);
    expect(second.id).not.toBe(first.id);
    await endCheck(second.id, database);
    expect(await database.shelfChecks.where('shelfId').equals(other.id).count()).toBe(1);
    await database.copies.where('shelfId').equals(other.id).delete();
    expect(await deleteShelfIfEmpty(other.id, database)).toBe(true);
    expect(await database.shelfChecks.count()).toBe(0);
  });
});

describe('positions des ouvrages scannés', () => {
  let database: LibraryDatabase;
  let shelf: Shelf;

  beforeEach(async () => {
    database = new LibraryDatabase(`test-${newId()}`);
    ({ shelf } = await createRoom('Salon', database));
  });

  afterEach(async () => {
    await database.delete();
  });

  it('donne à l’exemplaire la position de la lecture, et l’efface quand il change d’étagère', async () => {
    const existing = newBook({ isbn13: '9782070360420', title: 'La Peste', authors: [] });
    await database.books.add(existing);
    await database.copies.add({ ...newCopy(existing.id, shelf.id), lostAt: 5 });
    const session = await startSession(shelf.id, database);
    const entry = await recordIsbn(session, '9782070360420', { flagOwnedBooks: false, position: 42 }, database);
    const added = await database.copies.get(entry.copyId ?? '');
    expect(added?.position).toBe(42);

    const other = await createShelf(shelf.roomId, undefined, database);
    await moveCopy(added?.id ?? '', other.id, database);
    expect((await database.copies.get(added?.id ?? ''))?.position).toBeUndefined();

    // Moving a copy declared lost means it has been found.
    const lost = (await database.copies.where('bookId').equals(existing.id).toArray()).find((c) => c.lostAt !== undefined);
    await moveCopy(lost?.id ?? '', shelf.id, database);
    expect((await database.copies.get(lost?.id ?? ''))?.lostAt).toBeUndefined();
  });
});
