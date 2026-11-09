import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from './db';
import { newId } from './ids';
import type { Book } from './schema';
import { DEFAULT_SETTINGS, getSettings, mergeSettings, updateSettings } from './settings';

let database: LibraryDatabase;

beforeEach(() => {
  database = new LibraryDatabase(`test-${newId()}`);
});

afterEach(async () => {
  await database.delete();
});

const book = (fields: Partial<Book>): Book => ({
  id: newId(),
  title: 'La Peste',
  authors: ['Albert Camus'],
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...fields,
});

describe('base de données', () => {
  it('s’ouvre avec toutes les tables du modèle', async () => {
    await database.open();
    expect(database.tables.map((table) => table.name).sort()).toEqual(
      [
        'backup',
        'blobs',
        'books',
        'copies',
        'loans',
        'metadataCache',
        'pendingItems',
        'quotes',
        'readings',
        'rooms',
        'scanEntries',
        'scanSessions',
        'series',
        'settings',
        'shareUploads',
        'sharedPhotos',
        'sharedPlaces',
        'shelfChecks',
        'shelves',
        'sites',
        'wishes',
      ].sort(),
    );
  });

  it('refuse deux notices avec le même ISBN', async () => {
    await database.books.add(book({ isbn13: '9782070360420' }));
    await expect(database.books.add(book({ isbn13: '9782070360420' }))).rejects.toThrow();
  });

  it('accepte plusieurs notices sans ISBN', async () => {
    await database.books.add(book({ title: 'Sans code-barres 1' }));
    await database.books.add(book({ title: 'Sans code-barres 2' }));
    expect(await database.books.count()).toBe(2);
  });

  it('retrouve les exemplaires d’une notice', async () => {
    const notice = book({ isbn13: '9782070360024' });
    await database.books.add(notice);
    await database.copies.bulkAdd([
      { id: newId(), bookId: notice.id, shelfId: 'salon-2', addedAt: Date.now() },
      { id: newId(), bookId: notice.id, shelfId: 'chambre-1', addedAt: Date.now() },
    ]);
    expect(await database.copies.where('bookId').equals(notice.id).count()).toBe(2);
  });
});

describe('lecture à part de la notice (lot 12)', () => {
  it('sort de la notice le statut, la note et l’avis d’une base antérieure, sans rien perdre', async () => {
    const name = `test-${newId()}`;
    // The database as published before lot 12 (schema version 6).
    const before = new Dexie(name);
    before.version(6).stores({
      sites: 'id',
      rooms: 'id, order, siteId',
      shelves: 'id, roomId, &qrToken',
      books: 'id, &isbn13, status, createdAt, *tags',
      copies: 'id, bookId, shelfId, addedAt',
      pendingItems: 'id, kind, shelfId, sessionId, createdAt',
      scanSessions: 'id, shelfId, startedAt',
      loans: 'id, copyId, borrower, dueAt',
      wishes: 'id, isbn',
      quotes: 'id, bookId',
      metadataCache: 'isbn13, fetchedAt',
      blobs: 'id',
      settings: 'id',
      scanEntries: 'id, sessionId, status, createdAt',
      backup: 'id',
      shelfChecks: 'id, shelfId, startedAt',
      series: 'id',
    });
    const old = (id: string, title: string, status: string, rating: number, review: string) => ({
      id,
      title,
      authors: ['Albert Camus'],
      status,
      rating,
      review,
      tags: ['Classique'],
      createdAt: 1,
      updatedAt: 2,
    });
    await before.table('books').bulkAdd([
      { ...old('peste', 'La Peste', 'read', 4, 'D’une force intacte.'), isbn13: '9782070360420' },
      old('noces', 'Noces', 'toread', 0, ''),
      old('carnets', 'Carnets', 'toread', 0, 'À relire'),
    ]);
    before.close();

    const upgraded = new LibraryDatabase(name);
    try {
      const books = await upgraded.books.orderBy('id').toArray();
      expect(books.map((book) => Object.keys(book).sort())).toEqual([
        ['authors', 'createdAt', 'id', 'tags', 'title', 'updatedAt'],
        ['authors', 'createdAt', 'id', 'tags', 'title', 'updatedAt'],
        ['authors', 'createdAt', 'id', 'isbn13', 'tags', 'title', 'updatedAt'],
      ]);
      expect(await upgraded.books.where('isbn13').equals('9782070360420').count()).toBe(1);
      expect(await upgraded.readings.orderBy('bookId').toArray()).toEqual([
        { bookId: 'carnets', status: 'toread', rating: 0, review: 'À relire', updatedAt: 2 },
        { bookId: 'peste', status: 'read', rating: 4, review: 'D’une force intacte.', updatedAt: 2 },
      ]);
    } finally {
      await upgraded.delete();
    }
  });
});

describe('paramètres', () => {
  it('ont des valeurs par défaut, l’ordre sur l’étagère étant désactivé', async () => {
    const settings = await getSettings(database);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.rememberShelfOrder).toBe(false);
  });

  it('sont enregistrés et relus', async () => {
    await updateSettings({ scanSound: false, sources: { bnf: false } }, database);
    const settings = await getSettings(database);
    expect(settings.scanSound).toBe(false);
    expect(settings.sources).toEqual({ bnf: false, googleBooks: true, openLibrary: true, triomphe: true });
  });

  it('complètent un enregistrement ancien par les valeurs par défaut', () => {
    expect(mergeSettings({ id: 'app', scanVibration: false })).toEqual({ ...DEFAULT_SETTINGS, scanVibration: false });
  });
});

describe('newId', () => {
  it('produit des identifiants distincts au format UUID', () => {
    const ids = new Set(Array.from({ length: 100 }, newId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
