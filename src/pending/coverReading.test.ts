import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { ScanSession, Shelf } from '../db/schema';
import type { ReadCover, ReadOutcome } from '../metadata/openRouter';
import { createRoom } from '../places/places';
import { recordNoBarcode, startSession } from '../scan/session';
import { awaitsReading, currentReading, readItemCover } from './coverReading';
import { confirmReading, setItemPhoto } from './pending';

let database: LibraryDatabase;
let session: ScanSession;
let shelf: Shelf;

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  ({ shelf } = await createRoom('Salon', database));
  session = await startSession(shelf.id, database);
});

afterEach(async () => {
  await database.delete();
});

const read = (cover: ReadCover) => (): Promise<ReadOutcome> => Promise.resolve({ status: 'read', cover });
const LOTUS: ReadCover = { title: 'Le Lotus bleu', authors: ['Hergé'], publisher: 'Casterman', seriesName: 'Les Aventures de Tintin', seriesIndex: 5 };

async function photographedItem(): Promise<string> {
  const entry = await recordNoBarcode(session, new Blob(['jpeg']), {}, database);
  return entry.pendingItemId ?? '';
}

describe('lecture des couvertures de « À compléter » par OpenRouter', () => {
  it('conserve ce que OpenRouter a lu, lié à la photographie lue', async () => {
    const itemId = await photographedItem();
    const before = await database.pendingItems.get(itemId);
    expect(before && awaitsReading(before, 'clé')).toBe(true);
    expect(before && awaitsReading(before, '')).toBe(false);

    expect((await readItemCover(itemId, 'clé', database, read(LOTUS))).status).toBe('read');
    const item = await database.pendingItems.get(itemId);
    expect(item && currentReading(item)).toMatchObject(LOTUS);
    expect(item && awaitsReading(item, 'clé')).toBe(false);
  });

  it('ne garde rien quand OpenRouter est indisponible ou refuse la clé', async () => {
    const itemId = await photographedItem();
    expect((await readItemCover(itemId, 'clé', database, () => Promise.resolve({ status: 'busy' }))).status).toBe('busy');
    expect((await readItemCover(itemId, 'clé', database, () => Promise.resolve({ status: 'refused' }))).status).toBe('refused');
    expect((await database.pendingItems.get(itemId))?.coverReading).toBeUndefined();
  });

  it('écarte la lecture d’une photographie remplacée entre-temps, et l’oublie quand elle est reprise', async () => {
    const itemId = await photographedItem();
    await readItemCover(itemId, 'clé', database, async () => {
      await setItemPhoto(itemId, new Blob(['autre']), database);
      return { status: 'read', cover: LOTUS };
    });
    expect((await database.pendingItems.get(itemId))?.coverReading).toBeUndefined();

    await readItemCover(itemId, 'clé', database, read(LOTUS));
    await setItemPhoto(itemId, new Blob(['troisième']), database);
    expect((await database.pendingItems.get(itemId))?.coverReading).toBeUndefined();
  });

  it('« Confirmer » ajoute l’ouvrage lu, sa série et la photographie pour couverture', async () => {
    const itemId = await photographedItem();
    await readItemCover(itemId, 'clé', database, read(LOTUS));
    expect(await confirmReading(itemId, database)).toBe('Le Lotus bleu');
    const [book] = await database.books.toArray();
    expect(book).toMatchObject({ title: 'Le Lotus bleu', authors: ['Hergé'], publisher: 'Casterman', seriesName: 'Les Aventures de Tintin', seriesIndex: 5 });
    expect(book?.cover?.source).toBe('user');
    expect(await database.pendingItems.count()).toBe(0);
  });

  it('« Confirmer » n’ajoute rien quand OpenRouter n’a lu aucun titre', async () => {
    const itemId = await photographedItem();
    await readItemCover(itemId, 'clé', database, read({ title: '', authors: [] }));
    expect(await confirmReading(itemId, database)).toBeUndefined();
    expect(await database.pendingItems.count()).toBe(1);
  });
});
