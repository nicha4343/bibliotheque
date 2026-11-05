import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Room, Shelf, Site } from '../db/schema';
import { indexPlaces } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { duplicateRows, findDuplicates, isToGive, placesOf, setToGive } from './duplicates';

const sites: Site[] = [{ id: 'maison', name: 'Maison', order: 0 }];
const rooms: Room[] = [
  { id: 'salon', siteId: 'maison', name: 'Salon', order: 0 },
  { id: 'chambre', siteId: 'maison', name: 'Chambre', order: 1 },
];
const shelves: Shelf[] = [
  { id: 'salon-2', roomId: 'salon', name: 'Étagère 2', order: 0, qrToken: 'a' },
  { id: 'chevet', roomId: 'chambre', name: 'Table de chevet', order: 0, qrToken: 'b' },
];
const places = indexPlaces(sites, rooms, shelves);

let database: LibraryDatabase;

beforeEach(() => {
  database = new LibraryDatabase(`test-${newId()}`);
});

afterEach(async () => {
  await database.delete();
});

describe('doublons', () => {
  const etranger = newBook({ title: 'L’Étranger', authors: ['Albert Camus'], isbn13: '9782070360024' });
  const germinal = newBook({ title: 'Germinal', authors: ['Émile Zola'], tags: ['à donner'] });
  const peste = newBook({ title: 'La Peste', authors: ['Albert Camus'] });
  const copies = [
    newCopy(etranger.id, 'salon-2'),
    newCopy(etranger.id, 'chevet'),
    newCopy(germinal.id, 'salon-2'),
    newCopy(germinal.id, 'salon-2'),
    newCopy(germinal.id, 'salon-2'),
    newCopy(peste.id, 'salon-2'),
    { ...newCopy(peste.id, 'salon-2'), lostAt: 1 },
  ];

  it('retiennent les ouvrages en plusieurs exemplaires présents, ceux à donner marqués', () => {
    const duplicates = findDuplicates([peste, germinal, etranger], copies);
    expect(duplicates.map(({ book, copies: own, give }) => [book.title, own.length, give])).toEqual([
      ['L’Étranger', 2, false],
      ['Germinal', 3, true],
    ]);
  });

  it('indiquent leurs emplacements', () => {
    const [first, second] = findDuplicates([germinal, etranger], copies);
    expect(first && placesOf(first.copies, places)).toBe('Salon · Étagère 2 et Chambre · Table de chevet');
    expect(second && placesOf(second.copies, places)).toBe('Salon · Étagère 2 (3)');
    expect(duplicateRows(findDuplicates([germinal], copies), places)).toEqual([
      ['Titre', 'Auteurs', 'ISBN-13', 'Exemplaires', 'Emplacements', 'À donner'],
      ['Germinal', 'Émile Zola', '', '3', 'Salon · Étagère 2 (3)', 'Oui'],
    ]);
  });

  it('se marquent « À donner » par l’étiquette de la fiche, quelle que soit sa casse', async () => {
    await database.books.bulkAdd([etranger, germinal]);
    await setToGive(etranger, true, database);
    expect((await database.books.get(etranger.id))?.tags).toEqual(['À donner']);
    await setToGive(germinal, false, database);
    const after = await database.books.get(germinal.id);
    expect(after?.tags).toEqual([]);
    expect(after && isToGive(after)).toBe(false);
  });
});
