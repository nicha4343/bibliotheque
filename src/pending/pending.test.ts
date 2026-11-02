import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { ScanSession, Shelf } from '../db/schema';
import { updateSettings } from '../db/settings';
import { checkGoogleBooksKey } from '../metadata/googleBooksKey';
import { createRoom } from '../places/places';
import { newBook, recordNoBarcode, startSession } from '../scan/session';
import { completeItem, deleteItem, parseAuthors, retryItem, setItemPhoto } from './pending';

let database: LibraryDatabase;
let session: ScanSession;
let shelf: Shelf;

const ISBN = '9791090648217';

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  ({ shelf } = await createRoom('Salon', database));
  session = await startSession(shelf.id, database);
  await updateSettings({ autoCovers: false }, database);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
});

async function unknownIsbnItem(): Promise<string> {
  const id = newId();
  await database.pendingItems.add({ id, kind: 'unknownIsbn', isbn: ISBN, shelfId: shelf.id, sessionId: session.id, createdAt: 1 });
  return id;
}

describe('saisie des auteurs', () => {
  it('sépare les auteurs par une virgule ou un point-virgule', () => {
    expect(parseAuthors(' Victor  Hugo, Paul Meurice ; ')).toEqual(['Victor Hugo', 'Paul Meurice']);
    expect(parseAuthors('')).toEqual([]);
  });
});

describe('boîte « À compléter »', () => {
  it('crée la notice et son exemplaire, la photographie servant de couverture', async () => {
    const entry = await recordNoBarcode(session, new Blob(['jpeg']), {}, database);
    const itemId = entry.pendingItemId ?? '';
    const bookId = await completeItem(itemId, { title: ' Les Fleurs du mal ', authors: ['Charles Baudelaire'], publisher: '' }, shelf.id, database);
    const book = await database.books.get(bookId ?? '');
    expect(book?.title).toBe('Les Fleurs du mal');
    expect(book?.publisher).toBeUndefined();
    expect(book?.cover?.source).toBe('user');
    expect(await database.blobs.get(book?.cover?.blobId ?? '')).toBeDefined();
    expect(await database.copies.where('bookId').equals(bookId ?? '').count()).toBe(1);
    expect(await database.pendingItems.count()).toBe(0);
  });

  it('garde l’ISBN inconnu dans la notice saisie à la main', async () => {
    const itemId = await unknownIsbnItem();
    const bookId = await completeItem(itemId, { title: 'Carnet de randonnées', authors: [], publisher: 'Belvédère' }, shelf.id, database);
    expect((await database.books.get(bookId ?? ''))?.isbn13).toBe(ISBN);
  });

  it('ajoute un exemplaire si l’ISBN est entré entre-temps dans la bibliothèque', async () => {
    const existing = newBook({ isbn13: ISBN, title: 'Carnet', authors: [] });
    await database.books.add(existing);
    const itemId = await unknownIsbnItem();
    expect(await completeItem(itemId, { title: 'Autre titre', authors: [], publisher: '' }, shelf.id, database)).toBe(existing.id);
    expect(await database.books.count()).toBe(1);
    expect(await database.copies.where('bookId').equals(existing.id).count()).toBe(1);
  });

  it('retrouve un ISBN devenu connu', async () => {
    const itemId = await unknownIsbnItem();
    await database.metadataCache.put({
      isbn13: ISBN,
      payload: { isbn13: ISBN, title: 'Carnet de randonnées', authors: ['Collectif'], providers: ['googleBooks'] },
      fetchedAt: 0,
    });
    const outcome = await retryItem(itemId, database);
    expect(outcome).toMatchObject({ status: 'found', title: 'Carnet de randonnées' });
    expect(await database.pendingItems.count()).toBe(0);
    expect((await database.books.where('isbn13').equals(ISBN).first())?.authors).toEqual(['Collectif']);
  });

  it('laisse l’ouvrage de côté sans réseau', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    const itemId = await unknownIsbnItem();
    expect(await retryItem(itemId, database)).toEqual({ status: 'unavailable' });
    expect(await database.pendingItems.count()).toBe(1);
  });

  it('remplace la photographie et la supprime avec l’élément', async () => {
    const itemId = await unknownIsbnItem();
    await setItemPhoto(itemId, new Blob(['a']), database);
    await setItemPhoto(itemId, new Blob(['b']), database);
    expect(await database.blobs.count()).toBe(1);
    await deleteItem(itemId, database);
    expect(await database.blobs.count()).toBe(0);
    expect(await database.pendingItems.count()).toBe(0);
  });
});

describe('vérification de la clé Google Books', () => {
  const answering = (status: number): typeof fetch => () => Promise.resolve(new Response('{}', { status }));

  it('distingue une clé acceptée, refusée ou non vérifiable', async () => {
    expect(await checkGoogleBooksKey('k', answering(200))).toBe('valid');
    expect(await checkGoogleBooksKey('k', answering(400))).toBe('refused');
    expect(await checkGoogleBooksKey('k', answering(403))).toBe('refused');
    expect(await checkGoogleBooksKey('k', answering(429))).toBe('unverified');
    expect(await checkGoogleBooksKey('k', () => Promise.reject(new TypeError('offline')))).toBe('unverified');
  });
});
