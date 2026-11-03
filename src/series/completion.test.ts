import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import { newBook } from '../scan/session';
import { completeSeriesFromBnf, seriesByIsbn } from './completion';
import isbnXml from './fixtures/bnf-isbn.xml?raw';

let database: LibraryDatabase;

beforeEach(() => {
  database = new LibraryDatabase(`test-${newId()}`);
});

afterEach(async () => {
  await database.delete();
});

describe('séries des ouvrages déjà catalogués', () => {
  it('sont lues dans la réponse de la BnF, par ISBN', () => {
    expect([...seriesByIsbn(isbnXml)]).toEqual([
      ['9782843786952', { name: "Pat'Apouf", index: 17 }],
      ['9782843786129', { name: "Pat'Apouf", index: 14 }],
    ]);
  });

  it('sont demandées une fois, pour les seuls ouvrages hors de toute série', async () => {
    const tatoue = newBook({ title: "Pat'Apouf et l'empreinte du tatoué", authors: ['Gervy'], isbn13: '9782843786952' });
    const fusee = newBook({ title: 'Pat’Apouf en fusée', authors: ['Gervy'], isbn13: '9782843786129', seriesName: '' });
    const inconnu = newBook({ title: 'Inconnu', authors: [], isbn13: '9782070360024' });
    await database.books.bulkAdd([tatoue, fusee, inconnu]);
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(new Response(isbnXml));
    }) as typeof fetch;
    expect(await completeSeriesFromBnf(database, fetchImpl)).toBe(1);
    expect(await database.books.get(tatoue.id)).toMatchObject({ seriesName: "Pat'Apouf", seriesIndex: 17 });
    // Taken out of any series by the user: left so.
    expect((await database.books.get(fusee.id))?.seriesName).toBe('');
    expect((await database.books.get(inconnu.id))?.seriesCheckedAt).toBeTypeOf('number');
    expect(await completeSeriesFromBnf(database, fetchImpl)).toBe(0);
    expect(calls).toBe(1);
  });
});
