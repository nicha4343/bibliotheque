import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { ScanSession } from '../db/schema';
import { createRoom, defaultShelfName, nextShelf } from '../places/places';
import { resolveFound, resolveUnknown } from './lookups';
import {
  answerDuplicate,
  endSession,
  newBook,
  nextQuestion,
  recordIsbn,
  recordNoBarcode,
  startSession,
  undoLastEntry,
} from './session';

let database: LibraryDatabase;
let session: ScanSession;

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  const { shelf } = await createRoom('Salon', database);
  session = await startSession(shelf.id, database);
});

afterEach(async () => {
  await database.delete();
});

const ISBN = '9782070360420';
const metadata = { isbn13: ISBN, title: 'La Peste', authors: ['Albert Camus'], providers: ['bnf' as const] };

describe('pièces et étagères', () => {
  it('créent « Étagère 1 » avec une nouvelle pièce', async () => {
    const { room, shelf } = await createRoom('Bureau', database);
    expect(shelf.roomId).toBe(room.id);
    expect(shelf.name).toBe('Étagère 1');
    expect(shelf.qrToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('proposent le premier numéro d’étagère libre', () => {
    expect(defaultShelfName(['Étagère 1', 'Bandes dessinées'])).toBe('Étagère 3');
    expect(defaultShelfName(['Étagère 2'])).toBe('Étagère 3');
  });

  it('créent l’étagère suivante si besoin', async () => {
    const next = await nextShelf(session.shelfId, database);
    expect(next?.name).toBe('Étagère 2');
    expect((await nextShelf(session.shelfId, database))?.id).toBe(next?.id);
  });
});

describe('session de scan', () => {
  it('met un nouvel ISBN en recherche, puis crée la notice et son exemplaire', async () => {
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    expect(entry.status).toBe('searching');
    const bookId = await resolveFound(entry.id, metadata, database);
    expect(bookId).toBeDefined();
    expect((await database.scanEntries.get(entry.id))?.status).toBe('added');
    expect(await database.copies.where('bookId').equals(bookId ?? '').count()).toBe(1);
  });

  it('demande une réponse explicite pour un ouvrage déjà possédé', async () => {
    await database.books.add(newBook({ isbn13: ISBN, title: 'La Peste', authors: [] }));
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    expect(entry.status).toBe('asking');
    expect((await nextQuestion(session.id, database))?.id).toBe(entry.id);
    await answerDuplicate(entry.id, true, database);
    expect((await database.scanEntries.get(entry.id))?.status).toBe('extraCopy');
    expect(await database.copies.count()).toBe(1);
    expect(await nextQuestion(session.id, database)).toBeUndefined();
  });

  it('n’ajoute rien quand l’utilisateur refuse', async () => {
    await database.books.add(newBook({ isbn13: ISBN, title: 'La Peste', authors: [] }));
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    await answerDuplicate(entry.id, false, database);
    expect((await database.scanEntries.get(entry.id))?.status).toBe('notAdded');
    expect(await database.copies.count()).toBe(0);
  });

  it('ajoute directement un exemplaire quand l’option est désactivée', async () => {
    await database.books.add(newBook({ isbn13: ISBN, title: 'La Peste', authors: [] }));
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: false }, database);
    expect(entry.status).toBe('extraCopy');
    expect(await database.copies.count()).toBe(1);
  });

  it('pose la question si le même ISBN a été lu deux fois pendant la recherche', async () => {
    const first = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    const second = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    await resolveFound(first.id, metadata, database);
    await resolveFound(second.id, metadata, database);
    expect((await database.scanEntries.get(second.id))?.status).toBe('asking');
    expect(await database.books.count()).toBe(1);
  });

  it('met de côté un ISBN inconnu', async () => {
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    await resolveUnknown(entry.id, database);
    const item = await database.pendingItems.toCollection().first();
    expect(item).toMatchObject({ kind: 'unknownIsbn', isbn: ISBN, shelfId: session.shelfId });
  });

  it('annule la dernière lecture et ce qu’elle a créé', async () => {
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    await resolveFound(entry.id, metadata, database);
    await recordNoBarcode(session, new Blob(['jpeg']), {}, database);
    await undoLastEntry(session.id, database);
    expect(await database.pendingItems.count()).toBe(0);
    expect(await database.blobs.count()).toBe(0);
    await undoLastEntry(session.id, database);
    expect(await database.books.count()).toBe(0);
    expect(await database.copies.count()).toBe(0);
    expect(await database.scanEntries.count()).toBe(0);
  });

  it('ignore la réponse d’une recherche annulée entre-temps', async () => {
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    await undoLastEntry(session.id, database);
    expect(await resolveFound(entry.id, metadata, database)).toBeUndefined();
    expect(await database.books.count()).toBe(0);
  });

  it('compte les lectures à la fin de la session', async () => {
    const found = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    await resolveFound(found.id, metadata, database);
    await recordNoBarcode(session, new Blob(['jpeg']), {}, database);
    await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    const ended = await endSession(session.id, database);
    expect(ended?.counts).toEqual({ scanned: 3, added: 1, pending: 1, extraCopies: 0 });
    expect(ended?.endedAt).toBeDefined();
  });
});
