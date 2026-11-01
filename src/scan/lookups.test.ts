import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import bnfXml from '../metadata/fixtures/bnf.xml?raw';
import { findMetadata } from './lookups';

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
