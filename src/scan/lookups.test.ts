import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import bnfXml from '../metadata/fixtures/bnf.xml?raw';
import { createRoom } from '../places/places';
import { googleBooksPause, setSourcePacing } from '../metadata/search';
import { findMetadata, processEntry } from './lookups';
import { recordIsbn, startSession } from './session';

const ISBN = '9782070360420';
let database: LibraryDatabase;

/** BnF answers; Google Books answers only when googleBooksUp; Open Library knows nothing. */
function stubSources(googleBooksUp: () => boolean): void {
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('bnf')) return Promise.resolve(new Response(bnfXml));
    if (url.includes('googleapis')) return Promise.resolve(googleBooksUp() ? new Response('{}') : new Response('', { status: 429 }));
    return Promise.resolve(new Response('{}'));
  });
}

beforeEach(() => {
  database = new LibraryDatabase(`test-${newId()}`);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
});

describe('cache des métadonnées', () => {
  it('ne conserve pas une recherche incomplète, pour interroger de nouveau la source muette', async () => {
    let googleBooksUp = false;
    stubSources(() => googleBooksUp);
    const first = await findMetadata(ISBN, () => Promise.resolve(), database);
    expect(first?.providers).toEqual(['bnf']);
    expect(first?.incomplete).toBe(true);
    expect(await database.metadataCache.count()).toBe(0);

    googleBooksUp = true;
    const second = await findMetadata(ISBN, () => Promise.resolve(), database);
    expect(second?.incomplete).toBeUndefined();
    expect(await database.metadataCache.count()).toBe(1);
  });
});

describe('ISBN introuvable pendant qu’une source se tait', () => {
  it('est recherché de nouveau, puis déclaré inconnu à la troisième tentative', async () => {
    // BnF and Open Library know nothing; Google Books refuses (quota, burst).
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('googleapis')) return Promise.resolve(new Response('', { status: 429 }));
      return Promise.resolve(new Response(url.includes('bnf') ? '<searchRetrieveResponse/>' : '{}'));
    });
    const { shelf } = await createRoom('Salon', database);
    const session = await startSession(shelf.id, database);
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);

    expect(await processEntry(entry, database)).toBe(false);
    const waiting = await database.scanEntries.get(entry.id);
    expect(waiting).toMatchObject({ status: 'searching', attempts: 1 });
    expect(waiting?.retryAt).toBeGreaterThan(Date.now());
    expect(await processEntry(waiting ?? entry, database)).toBe(false);

    expect(await processEntry((await database.scanEntries.get(entry.id)) ?? entry, database)).toBe(true);
    expect((await database.scanEntries.get(entry.id))?.status).toBe('pending');
    // Not declared unknown: Google Books did not answer, it is searched again by itself.
    const item = await database.pendingItems.toCollection().first();
    expect(item?.silentSources).toEqual(['googleBooks']);
    expect(item?.retryAt).toBeGreaterThan(Date.now());
  });

  it('est mis de côté dès la première recherche quand Google Books a épuisé son quota du jour', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('googleapis')) return Promise.resolve(new Response("limit 'Queries per day'", { status: 429 }));
      return Promise.resolve(new Response(url.includes('bnf') ? '<searchRetrieveResponse/>' : '{}'));
    });
    const { shelf } = await createRoom('Salon', database);
    const session = await startSession(shelf.id, database);
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    try {
      expect(await processEntry(entry, database)).toBe(true);
      const item = await database.pendingItems.toCollection().first();
      expect(item?.silentSources).toEqual(['googleBooks']);
      // Searched again only after Google's next midnight.
      expect(item?.retryAt).toBeGreaterThan(googleBooksPause()?.until ?? Infinity);
    } finally {
      setSourcePacing({ spacingMs: 0, retryDelaysMs: [0, 0] });
    }
  });

  it('est déclaré inconnu quand toutes les sources ont répondu', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(url.includes('bnf') ? '<searchRetrieveResponse/>' : '{}'));
    });
    const { shelf } = await createRoom('Salon', database);
    const session = await startSession(shelf.id, database);
    const entry = await recordIsbn(session, ISBN, { flagOwnedBooks: true }, database);
    expect(await processEntry(entry, database)).toBe(true);
    const item = await database.pendingItems.toCollection().first();
    expect(item?.silentSources).toBeUndefined();
    expect(item?.retryAt).toBeUndefined();
  });
});
