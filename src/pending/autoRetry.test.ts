import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Shelf } from '../db/schema';
import { updateSettings } from '../db/settings';
import googleBooksJson from '../metadata/fixtures/googleBooks.json';
import { createRoom } from '../places/places';
import { startSession } from '../scan/session';
import { retryDueItems } from './autoRetry';
import { retryItem } from './pending';

// La Peste, which the fixture of Google Books describes.
const ISBN = '9782070360420';
let database: LibraryDatabase;
let shelf: Shelf;
let googleBooksUp = false;

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  ({ shelf } = await createRoom('Salon', database));
  await updateSettings({ autoCovers: false }, database);
  googleBooksUp = false;
  // BnF and Open Library know nothing; Google Books refuses a burst, or answers.
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('googleapis')) {
      return Promise.resolve(googleBooksUp ? new Response(JSON.stringify(googleBooksJson)) : new Response('', { status: 429 }));
    }
    return Promise.resolve(new Response(url.includes('bnf') ? '<searchRetrieveResponse/>' : '{}'));
  });
  vi.stubGlobal('window', { location: { hash: '#/a-completer' } });
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
});

async function waitingItem(retryAt: number): Promise<string> {
  const session = await startSession(shelf.id, database);
  const id = newId();
  await database.pendingItems.add({
    id,
    kind: 'unknownIsbn',
    isbn: ISBN,
    shelfId: shelf.id,
    sessionId: session.id,
    createdAt: 1,
    silentSources: ['googleBooks'],
    retryAt,
  });
  return id;
}

describe('ISBN mis de côté pendant qu’une source se taisait', () => {
  it('est recherché de nouveau plus tard, à intervalles croissants, tant que la source se tait', async () => {
    const id = await waitingItem(0);
    expect(await retryItem(id, database)).toEqual({ status: 'incomplete' });
    const first = await database.pendingItems.get(id);
    expect(first).toMatchObject({ silentSources: ['googleBooks'], retries: 1 });
    expect(first?.retryAt).toBeGreaterThan(Date.now() + 20 * 60 * 1000);

    await retryItem(id, database);
    expect((await database.pendingItems.get(id))?.retryAt).toBeGreaterThan((first?.retryAt ?? 0) + 60 * 60 * 1000);
  });

  it('devient inconnu quand toutes les sources ont répondu sans le connaître', async () => {
    const id = await waitingItem(0);
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(url.includes('bnf') ? '<searchRetrieveResponse/>' : '{}'));
    });
    expect(await retryItem(id, database)).toEqual({ status: 'unknown' });
    const item = await database.pendingItems.get(id);
    expect(item?.silentSources).toBeUndefined();
    expect(item?.retryAt).toBeUndefined();
  });

  it('est retrouvé de lui-même à son heure, et pas avant', async () => {
    googleBooksUp = true;
    const later = await waitingItem(Date.now() + 60 * 60 * 1000);
    await retryDueItems(database);
    expect(await database.pendingItems.get(later)).toBeDefined();

    await database.pendingItems.update(later, { retryAt: Date.now() - 1 });
    await retryDueItems(database);
    expect(await database.pendingItems.count()).toBe(0);
    expect((await database.books.where('isbn13').equals(ISBN).first())?.title).toBe('La peste');
  });

  it('attend la fin du scan', async () => {
    googleBooksUp = true;
    vi.stubGlobal('window', { location: { hash: '#/scanner' } });
    await waitingItem(0);
    await retryDueItems(database);
    expect(await database.pendingItems.count()).toBe(1);
  });
});
