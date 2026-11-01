import 'fake-indexeddb/auto';
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
  status: 'toread',
  rating: 0,
  review: '',
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
        'blobs',
        'books',
        'copies',
        'loans',
        'metadataCache',
        'pendingItems',
        'quotes',
        'rooms',
        'scanEntries',
        'scanSessions',
        'settings',
        'shelves',
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
    expect(settings.sources).toEqual({ bnf: false, googleBooks: true, openLibrary: true });
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
