import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import { addQuote } from '../books/quotes';
import type { Room, ScanEntry, Shelf, Site } from '../db/schema';
import { lastShelfId, newBook, newCopy, startSession } from '../scan/session';
import {
  createRoom,
  createShelf,
  createSite,
  deleteRoom,
  deleteShelf,
  deleteSite,
  findOrCreateShelf,
  indexPlaces,
  isEmptyPlace,
  loadPlaces,
  moveRoom,
  placeContents,
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

  it('ne supprime jamais le dernier lieu ; un autre part avec ses pièces, ses étagères et leurs ouvrages', async () => {
    const [maison] = await database.sites.toArray();
    expect(await deleteSite(maison?.id ?? '', database)).toBe(false);

    const campagne = await createSite('Maison de campagne', database);
    const { room, shelf } = await createRoom('Séjour', database, campagne.id);
    await createShelf(room.id, 'Haut', database);
    const peste = newBook({ title: 'La Peste', authors: ['Albert Camus'] });
    await database.books.add(peste);
    await database.copies.add(newCopy(peste.id, shelf.id));
    expect(await placeContents('site', campagne.id, database)).toEqual({ copies: 1, books: 1, kept: 0, lent: 0, waiting: 0 });

    expect(await deleteSite(campagne.id, database)).toBe(true);
    expect(await database.sites.count()).toBe(1);
    expect(await database.rooms.count()).toBe(0);
    expect(await database.shelves.count()).toBe(0);
    expect(await database.books.count()).toBe(0);
    expect(await deleteSite(maison?.id ?? '', database)).toBe(false);
  });

  it('supprime une pièce vide avec ses étagères, sans avertissement', async () => {
    const { room } = await createRoom('Grenier', database);
    await createShelf(room.id, 'Cartons', database);
    expect(isEmptyPlace(await placeContents('room', room.id, database))).toBe(true);
    await deleteRoom(room.id, database);
    expect(await database.rooms.count()).toBe(0);
    expect(await database.shelves.count()).toBe(0);
  });

  it('supprime une étagère pleine avec tout ce qui s’y trouve, et seulement cela', async () => {
    const { room, shelf } = await createRoom('Salon', database);
    const other = await createShelf(room.id, 'Haut', database);
    // Only here: the notice leaves the library with its photograph, reading and quotes.
    const peste = newBook({ title: 'La Peste', authors: ['Albert Camus'], cover: { source: 'user', blobId: 'photo-peste' } });
    // Also on the other shelf: the notice stays, with that copy.
    const etranger = newBook({ title: 'L’Étranger', authors: ['Albert Camus'] });
    await database.books.bulkAdd([peste, etranger]);
    await database.blobs.add({ id: 'photo-peste', blob: new Blob(['photo']), createdAt: 0 });
    await database.readings.add({ bookId: peste.id, status: 'read', rating: 4, review: '', updatedAt: 0 });
    await addQuote(peste.id, { text: 'Il y a dans les hommes plus de choses à admirer que de choses à mépriser.' }, database);
    const pesteHere = newCopy(peste.id, shelf.id);
    const etrangerHere = newCopy(etranger.id, shelf.id);
    const etrangerThere = newCopy(etranger.id, other.id);
    await database.copies.bulkAdd([pesteHere, etrangerHere, etrangerThere]);
    await database.loans.add({ id: 'pret', copyId: etrangerHere.id, borrower: 'Sam', lentAt: 0, dueAt: 1 });
    await database.blobs.add({ id: 'photo-inconnu', blob: new Blob(['x']), createdAt: 0 });
    await database.pendingItems.add({
      id: 'inconnu',
      kind: 'noBarcode',
      photoBlobId: 'photo-inconnu',
      shelfId: shelf.id,
      sessionId: 'ancienne',
      createdAt: 0,
    });
    const session = await startSession(shelf.id, database);
    const read = (id: string, shelfId: string): ScanEntry => ({
      id,
      sessionId: session.id,
      shelfId,
      kind: 'isbn',
      isbn13: '9782070360024',
      status: 'searching',
      createdAt: 0,
    });
    await database.scanEntries.bulkAdd([read('ici', shelf.id), read('ailleurs', other.id)]);

    expect(await placeContents('shelf', shelf.id, database)).toEqual({ copies: 2, books: 1, kept: 1, lent: 1, waiting: 2 });
    await deleteShelf(shelf.id, database);

    expect(await database.shelves.get(shelf.id)).toBeUndefined();
    expect((await database.books.toArray()).map((book) => book.title)).toEqual(['L’Étranger']);
    expect((await database.copies.toArray()).map((copy) => copy.id)).toEqual([etrangerThere.id]);
    expect(await database.readings.count()).toBe(0);
    expect(await database.quotes.count()).toBe(0);
    expect(await database.loans.count()).toBe(0);
    expect(await database.pendingItems.count()).toBe(0);
    expect(await database.blobs.count()).toBe(0);
    // The read waiting for the other shelf goes on; the session open on this one is over, and the next
    // scan asks where to put the books.
    expect((await database.scanEntries.toArray()).map((entry) => entry.id)).toEqual(['ailleurs']);
    expect((await database.scanSessions.get(session.id))?.endedAt).toBeDefined();
    expect(await lastShelfId(database)).toBeUndefined();
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
