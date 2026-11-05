import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Room, Shelf, Site } from '../db/schema';
import { newBook, newCopy } from '../scan/session';
import {
  createRoom,
  createShelf,
  createSite,
  deleteSiteIfEmpty,
  findOrCreateShelf,
  indexPlaces,
  loadPlaces,
  moveRoom,
} from './places';

let database: LibraryDatabase;

beforeEach(() => {
  database = new LibraryDatabase(`test-${newId()}`);
});

afterEach(async () => {
  await database.delete();
});

describe('lieux', () => {
  it('une bibliothèque neuve commence avec un premier lieu, « Maison »', async () => {
    const sites = await database.sites.toArray();
    expect(sites.map((site) => site.name)).toEqual(['Maison']);
    const { room } = await createRoom('Salon', database);
    expect(room.siteId).toBe(sites[0]?.id);
  });

  it('range dans « Maison » les pièces d’une bibliothèque antérieure aux lieux, sans rien perdre', async () => {
    const name = `test-${newId()}`;
    // The database as published before lot 10 (schema version 5).
    const before = new Dexie(name);
    before.version(5).stores({
      rooms: 'id, order',
      shelves: 'id, roomId, &qrToken',
      books: 'id, &isbn13, status, createdAt, *tags',
      copies: 'id, bookId, shelfId, addedAt',
      pendingItems: 'id, kind, shelfId, sessionId, createdAt',
      scanSessions: 'id, shelfId, startedAt',
      loans: 'id, copyId, borrower, dueAt',
      wishes: 'id, isbn',
      quotes: 'id, bookId',
      metadataCache: 'isbn13, fetchedAt',
      blobs: 'id',
      settings: 'id',
      scanEntries: 'id, sessionId, status, createdAt',
      backup: 'id',
      shelfChecks: 'id, shelfId, startedAt',
      series: 'id',
    });
    await before.table('rooms').bulkAdd([
      { id: 'salon', name: 'Salon', order: 0 },
      { id: 'bureau', name: 'Bureau', order: 1 },
    ]);
    await before.table('shelves').add({ id: 'salon-1', roomId: 'salon', name: 'Étagère 1', order: 0, qrToken: 'a' });
    before.close();

    const upgraded = new LibraryDatabase(name);
    try {
      const sites = await upgraded.sites.toArray();
      expect(sites.map((site) => site.name)).toEqual(['Maison']);
      const rooms = await upgraded.rooms.toArray();
      expect(rooms.map((room) => room.siteId)).toEqual([sites[0]?.id, sites[0]?.id]);
      expect(await upgraded.rooms.where('siteId').equals(sites[0]?.id ?? '').count()).toBe(2);
      const places = await loadPlaces(upgraded);
      expect(places.byShelfId.get('salon-1')?.label).toBe('Salon · Étagère 1');
    } finally {
      await upgraded.delete();
    }
  });

  it('ne nomme le lieu dans les emplacements que s’il y en a plusieurs', () => {
    const maison: Site = { id: 'maison', name: 'Maison', order: 0 };
    const campagne: Site = { id: 'campagne', name: 'Maison de campagne', order: 1 };
    const rooms: Room[] = [
      { id: 'sejour', siteId: 'campagne', name: 'Séjour', order: 0 },
      { id: 'salon', siteId: 'maison', name: 'Salon', order: 1 },
      // A room whose place has vanished stays visible, in the first place.
      { id: 'grenier', siteId: 'disparu', name: 'Grenier', order: 2 },
    ];
    const shelves: Shelf[] = [
      { id: 's1', roomId: 'salon', name: 'Étagère 1', order: 0, qrToken: 'a' },
      { id: 'j1', roomId: 'sejour', name: 'Étagère 1', order: 0, qrToken: 'b' },
      { id: 'g1', roomId: 'grenier', name: 'Cartons', order: 0, qrToken: 'c' },
    ];

    const one = indexPlaces([maison], rooms.slice(1), shelves);
    expect(one.severalSites).toBe(false);
    expect(one.byShelfId.get('s1')?.label).toBe('Salon · Étagère 1');

    const two = indexPlaces([campagne, maison], rooms, shelves);
    expect(two.severalSites).toBe(true);
    expect(two.sites.map((site) => site.id)).toEqual(['maison', 'campagne']);
    expect(two.rooms.map((room) => room.id)).toEqual(['salon', 'grenier', 'sejour']);
    expect(two.byShelfId.get('j1')).toMatchObject({ label: 'Maison de campagne · Séjour · Étagère 1', roomLabel: 'Séjour · Étagère 1' });
    expect(two.byShelfId.get('g1')?.label).toBe('Maison · Grenier · Cartons');
    expect(two.roomsBySite.get('campagne')?.map((room) => room.name)).toEqual(['Séjour']);
  });

  it('crée une pièce dans le lieu choisi et la déplace dans un autre', async () => {
    const campagne = await createSite('Maison de campagne', database);
    const { room, shelf } = await createRoom('Séjour', database, campagne.id);
    let places = await loadPlaces(database);
    expect(places.byShelfId.get(shelf.id)?.label).toBe('Maison de campagne · Séjour · Étagère 1');
    const maison = places.sites[0];
    await moveRoom(room.id, maison?.id ?? '', database);
    places = await loadPlaces(database);
    expect(places.byShelfId.get(shelf.id)?.site.name).toBe('Maison');
  });

  it('ne supprime ni le dernier lieu ni un lieu qui contient des ouvrages', async () => {
    const [maison] = await database.sites.toArray();
    expect(await deleteSiteIfEmpty(maison?.id ?? '', database)).toBe(false);

    const campagne = await createSite('Maison de campagne', database);
    const { shelf } = await createRoom('Séjour', database, campagne.id);
    const peste = newBook({ title: 'La Peste', authors: ['Albert Camus'] });
    await database.books.add(peste);
    const copy = newCopy(peste.id, shelf.id);
    await database.copies.add(copy);
    expect(await deleteSiteIfEmpty(campagne.id, database)).toBe(false);
    expect(await database.sites.count()).toBe(2);

    await database.copies.delete(copy.id);
    await createShelf((await database.rooms.toArray())[0]?.id ?? '', 'Haut', database);
    expect(await deleteSiteIfEmpty(campagne.id, database)).toBe(true);
    expect(await database.sites.count()).toBe(1);
    expect(await database.rooms.count()).toBe(0);
    expect(await database.shelves.count()).toBe(0);
  });

  it('retrouve ou crée la pièce d’un fichier importé dans le lieu nommé', async () => {
    const salon = await findOrCreateShelf('Salon', 'Étagère 1', database);
    // Same room name in another place: another room.
    const ailleurs = await findOrCreateShelf('salon', 'étagère 1', database, 'Maison de campagne');
    expect(ailleurs.id).not.toBe(salon.id);
    expect((await database.sites.toArray()).map((site) => site.name).sort()).toEqual(['Maison', 'Maison de campagne']);
    // Named again, the place is found, not created twice.
    expect((await findOrCreateShelf('Salon', 'Étagère 1', database, 'MAISON DE CAMPAGNE')).id).toBe(ailleurs.id);
    // Without a place, the room of the first place is found.
    expect((await findOrCreateShelf('Salon', 'Étagère 1', database)).id).toBe(salon.id);
    expect(await database.sites.count()).toBe(2);
  });
});
