import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { ScanSession, Shelf } from '../db/schema';
import { confirmReading, setItemPhoto } from '../pending/pending';
import { createRoom } from '../places/places';
import { newBook, recordNoBarcode, startSession } from '../scan/session';
import type { RecognizedImage } from './engine';
import { currentReading, readItem } from './reading';

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

/** A cover where Tesseract reads these lines, the first ones largest. */
const cover = (...texts: string[]): RecognizedImage => ({
  width: 1000,
  height: 1500,
  lines: texts.map((text, index) => ({
    text,
    confidence: 95,
    words: text.split(' ').map((word) => ({ text: word, confidence: 95 })),
    left: 100,
    top: index * 300,
    width: 800,
    height: 120 - index * 30,
  })),
});

async function photographedItem(): Promise<string> {
  const entry = await recordNoBarcode(session, new Blob(['jpeg']), {}, database);
  return entry.pendingItemId ?? '';
}

describe('lecture des photographies de « À compléter »', () => {
  it('conserve le titre, l’auteur et l’éditeur relevés sur la photographie', async () => {
    const itemId = await photographedItem();
    await database.books.add(newBook({ title: 'Les Paradis artificiels', authors: ['Charles Baudelaire'] }));
    await readItem(itemId, database, () => Promise.resolve(cover('LES FLEURS DU MAL', 'BAUDELAIRE', 'FOLIO')));
    const item = await database.pendingItems.get(itemId);
    expect(item && currentReading(item)).toMatchObject({
      titles: ['Les Fleurs du mal'],
      // The library knows the author: the full name is suggested.
      authors: ['Charles Baudelaire'],
      publishers: ['Folio'],
    });
  });

  it('relit selon la mise en page automatique une couverture sans titre lisible', async () => {
    const itemId = await photographedItem();
    await readItem(itemId, database, (_photo, layout) =>
      Promise.resolve(layout === 'sparse' ? cover('ÉDITIONS DU TRIOMPHE') : cover('EN FUSÉE', 'ÉDITIONS DU TRIOMPHE')),
    );
    expect((await database.pendingItems.get(itemId))?.reading).toMatchObject({ titles: ['En fusée'], publishers: ['Éditions du Triomphe'] });
  });

  it('écarte la lecture d’une photographie remplacée entre-temps', async () => {
    const itemId = await photographedItem();
    await readItem(itemId, database, async () => {
      await setItemPhoto(itemId, new Blob(['autre']), database);
      return cover('LES FLEURS DU MAL');
    });
    expect((await database.pendingItems.get(itemId))?.reading).toBeUndefined();
  });

  it('oublie la lecture quand la photographie est reprise', async () => {
    const itemId = await photographedItem();
    await readItem(itemId, database, () => Promise.resolve(cover('LES FLEURS DU MAL')));
    await setItemPhoto(itemId, new Blob(['autre']), database);
    const item = await database.pendingItems.get(itemId);
    expect(item?.reading).toBeUndefined();
    expect(item && currentReading(item)).toBeUndefined();
  });

  it('« Confirmer » ajoute l’ouvrage avec ce qui a été relevé, la photographie pour couverture', async () => {
    const itemId = await photographedItem();
    await readItem(itemId, database, () => Promise.resolve(cover('LES FLEURS DU MAL', 'CHARLES BAUDELAIRE', 'Gallimard')));
    expect(await confirmReading(itemId, database)).toBe('Les Fleurs du mal');
    const [book] = await database.books.toArray();
    expect(book).toMatchObject({ title: 'Les Fleurs du mal', authors: ['Charles Baudelaire'], publisher: 'Gallimard' });
    expect(book?.cover?.source).toBe('user');
    expect(await database.pendingItems.count()).toBe(0);
  });

  it('« Confirmer » n’ajoute rien sans titre relevé', async () => {
    const itemId = await photographedItem();
    await readItem(itemId, database, () => Promise.resolve(cover('ÿ ee')));
    expect(await confirmReading(itemId, database)).toBeUndefined();
    expect(await database.pendingItems.count()).toBe(1);
  });
});
