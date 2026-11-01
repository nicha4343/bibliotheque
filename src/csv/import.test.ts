import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Shelf } from '../db/schema';
import { createRoom, createShelf, indexPlaces } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { parseCsv } from './csv';
import { exportLibrary, exportRows } from './export';
import { applyImport, previewImport } from './import';
import { readLibraryFile, type ImportedBook } from './read';

let database: LibraryDatabase;
let salon: Shelf;

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  ({ shelf: salon } = await createRoom('Salon', database));
});

afterEach(async () => {
  await database.delete();
});

const imported = (title: string, isbn13?: string, copies: ImportedBook['copies'] = [{}]): ImportedBook => ({
  fields: { title, authors: ['Albert Camus'], status: 'toread', rating: 0, review: '', tags: [], ...(isbn13 ? { isbn13 } : {}) },
  copies,
});

describe('import', () => {
  it('ignore les ouvrages déjà présents, par ISBN ou, sans ISBN, par titre et auteur', async () => {
    await database.books.add(newBook({ isbn13: '9782070360420', title: 'La Peste', authors: ['Albert Camus'] }));
    await database.books.add(newBook({ title: 'Carnets', authors: ['Albert Camus'] }));
    const books = [imported('La Peste', '9782070360420'), imported('CARNETS'), imported('L’Étranger', '9782070360024')];
    const preview = await previewImport(books, database);
    expect(preview.owned).toBe(2);
    expect(preview.newBooks.map((book) => book.fields.title)).toEqual(['L’Étranger']);
    expect(preview.needsShelf).toBe(true);
  });

  it('range les exemplaires dans les pièces et étagères du fichier, créées au besoin, les autres sur l’étagère choisie', async () => {
    const books = [
      imported('La Peste', '9782070360420', [{ room: 'salon', shelf: 'étagère 1' }, { room: 'Bureau', shelf: 'Haut' }]),
      imported('Noces', undefined, [{ room: 'Bureau' }]),
      imported('L’Étranger', '9782070360024', [{}]),
    ];
    const result = await applyImport(books, salon.id, database);
    expect(result.bookIds).toHaveLength(3);
    expect(result.searchableIds).toHaveLength(2);
    expect(result.copies).toBe(4);

    const rooms = await database.rooms.toArray();
    expect(rooms.map((room) => room.name).sort()).toEqual(['Bureau', 'Salon']);
    const bureau = rooms.find((room) => room.name === 'Bureau');
    const bureauShelves = await database.shelves.where('roomId').equals(bureau?.id ?? '').toArray();
    expect(bureauShelves.map((shelf) => shelf.name).sort()).toEqual(['Haut', 'Étagère 1']);
    expect(await database.copies.where('shelfId').equals(salon.id).count()).toBe(2);
  });

  it('n’ajoute rien quand le même fichier est importé deux fois', async () => {
    const books = [imported('La Peste', '9782070360420'), imported('Noces')];
    await applyImport(books, salon.id, database);
    const again = await applyImport(books, salon.id, database);
    expect(again.bookIds).toEqual([]);
    expect(await database.books.count()).toBe(2);
  });

  it('n’importe rien si une étagère manque', async () => {
    await expect(applyImport([imported('Noces')], undefined, database)).rejects.toThrow();
    expect(await database.books.count()).toBe(0);
  });
});

describe('export puis import', () => {
  it('restitue les notices, les exemplaires et leurs emplacements', async () => {
    const bureau = (await createRoom('Bureau', database)).shelf;
    const haut = await createShelf(bureau.roomId, 'Haut', database);
    const peste = newBook({
      isbn13: '9782070360420',
      isbn10: '2070360423',
      title: 'La Peste',
      authors: ['Albert Camus'],
      publisher: 'Gallimard; Folio',
      year: 1972,
      seriesName: 'Folio',
      seriesIndex: 42,
      status: 'read',
      rating: 4,
      review: 'Un « grand » livre,\nrelu en 2026',
      tags: ['Classique', 'Dédicacé'],
    });
    const carnet = newBook({ title: 'Carnet sans code', authors: [] });
    await database.books.bulkAdd([peste, carnet]);
    const copies = [newCopy(peste.id, salon.id), { ...newCopy(peste.id, haut.id), note: 'Abîmé' }, newCopy(carnet.id, bureau.id)];
    await database.copies.bulkAdd(copies);

    const exported = await exportLibrary(database);
    expect(exported).toMatchObject({ books: 2, copies: 3 });
    const rows = parseCsv(exported.text);
    expect(rows).toHaveLength(4);
    // Sorted by room, then shelf: Salon (created first), then Bureau.
    expect(rows.slice(1).map((row) => row[0])).toEqual(['La Peste', 'Carnet sans code', 'La Peste']);

    const read = readLibraryFile(rows);
    if (!read.ok) throw new Error(read.error);
    const target = new LibraryDatabase(`test-${newId()}`);
    try {
      const result = await applyImport(read.books, undefined, target);
      expect(result.copies).toBe(3);
      const restored = await target.books.where('isbn13').equals('9782070360420').first();
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = peste;
      expect(restored).toMatchObject(fields);
      const places = indexPlaces(await target.rooms.toArray(), await target.shelves.toArray());
      const labels = (await target.copies.toArray()).map((copy) => places.byShelfId.get(copy.shelfId)?.label).sort();
      expect(labels).toEqual(['Bureau · Haut', 'Bureau · Étagère 1', 'Salon · Étagère 1']);
      expect((await target.copies.toArray()).some((copy) => copy.note === 'Abîmé')).toBe(true);
    } finally {
      await target.delete();
    }
  });

  it('écrit l’en-tête même pour une bibliothèque vide', () => {
    expect(exportRows([], [], indexPlaces([], []))).toHaveLength(1);
  });
});
