import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book } from '../db/schema';
import bnfXml from './fixtures/bnf.xml?raw';
import { SearchUnavailable, searchMetadata } from './search';
import { findInTriompheCatalog } from './triomphe';
import { completeFromTriompheCatalog } from './triompheCompletion';

// A book of 2026, unknown to the BnF on 9 November 2026.
const SURVIVORS = '9782383861409';

describe('liste des Éditions du Triomphe', () => {
  it('connaît le titre, l’auteur, l’éditeur et l’année d’un ouvrage', async () => {
    expect(await findInTriompheCatalog(SURVIVORS)).toEqual({
      provider: 'triomphe',
      title: 'Les Survivants des quatre vallées',
      authors: ['Raphaël Frémont'],
      publisher: 'Éditions du Triomphe',
      year: 2026,
    });
    expect(await findInTriompheCatalog('9782070360420')).toBeUndefined();
  });

  it('reconnaît un ouvrage que les autres sources ignorent, même sans réseau', async () => {
    const metadata = await searchMetadata(SURVIVORS, {
      sources: { bnf: true, googleBooks: true, openLibrary: true, triomphe: true },
      fetchImpl: () => Promise.reject(new TypeError('offline')),
    });
    expect(metadata.providers).toEqual(['triomphe']);
    expect(metadata.title).toBe('Les Survivants des quatre vallées');
    // The other sources are asked again next time.
    expect(metadata.incomplete).toBe(true);
  });

  it('ne déclare pas inconnu sans réseau un ouvrage qu’elle ignore', async () => {
    await expect(
      searchMetadata('9782070360420', {
        sources: { bnf: true, googleBooks: true, openLibrary: true, triomphe: true },
        fetchImpl: () => Promise.reject(new TypeError('offline')),
      }),
    ).rejects.toBeInstanceOf(SearchUnavailable);
    // Alone, it is the only judge.
    const alone = await searchMetadata('9782070360420', {
      sources: { bnf: false, googleBooks: false, openLibrary: false, triomphe: true },
      fetchImpl: () => Promise.reject(new TypeError('offline')),
    });
    expect(alone.providers).toEqual([]);
    expect(alone.incomplete).toBeUndefined();
  });

  it('répond la première ; les autres sources complètent les champs vides', async () => {
    const metadata = await searchMetadata(SURVIVORS, {
      sources: { bnf: true, googleBooks: false, openLibrary: false, triomphe: true },
      fetchImpl: () => Promise.resolve(new Response(bnfXml)),
    });
    expect(metadata.providers).toEqual(['triomphe', 'bnf']);
    expect(metadata.title).toBe('Les Survivants des quatre vallées');
    expect(metadata.language).toBe('fr');
  });

  it('n’est pas interrogée quand elle est désactivée', async () => {
    const metadata = await searchMetadata(SURVIVORS, {
      sources: { bnf: true, googleBooks: false, openLibrary: false, triomphe: false },
      fetchImpl: () => Promise.resolve(new Response('<x/>')),
    });
    expect(metadata.providers).toEqual([]);
  });
});

describe('fiches déjà présentes', () => {
  let database: LibraryDatabase;

  beforeEach(() => {
    database = new LibraryDatabase(`test-${newId()}`);
  });

  afterEach(async () => {
    await database.delete();
  });

  const book = (fields: Partial<Book>): Book => ({
    id: newId(),
    title: '',
    authors: [],
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  });

  it('complète les champs vides sans rien remplacer', async () => {
    const empty = book({ isbn13: SURVIVORS, title: 'Les survivants des quatre vallées' });
    // La Maison du bout du monde (2018).
    const typed = book({ isbn13: '9782843785955', title: 'Maison', authors: ['Inconnu'], publisher: 'Triomphe', year: 2017 });
    const other = book({ isbn13: '9782070360420', title: 'La Peste' });
    await database.books.bulkAdd([empty, typed, other]);

    expect(await completeFromTriompheCatalog(database)).toBe(1);
    expect(await database.books.get(empty.id)).toMatchObject({
      title: 'Les survivants des quatre vallées',
      authors: ['Raphaël Frémont'],
      publisher: 'Éditions du Triomphe',
      year: 2026,
    });
    expect((await database.books.get(empty.id))?.updatedAt).toBeGreaterThan(0);
    expect(await database.books.get(typed.id)).toEqual(typed);
    expect(await database.books.get(other.id)).toEqual(other);
    expect(await completeFromTriompheCatalog(database)).toBe(0);
  });
});
