import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Id, Room, Shelf } from '../db/schema';
import { fr } from '../textes/fr';

/** Random token printed in a shelf's QR code (URL-safe, 16 characters). */
export function newQrToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** « Étagère N » with the first N not already used in the room. */
export function defaultShelfName(existing: readonly string[]): string {
  let n = existing.length + 1;
  while (existing.includes(fr.places.defaultShelfName(n))) n += 1;
  return fr.places.defaultShelfName(n);
}

export const sortByOrder = <T extends { order: number; name: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'fr'));

export async function createShelf(roomId: Id, name?: string, database: LibraryDatabase = db): Promise<Shelf> {
  return database.transaction('rw', database.shelves, async () => {
    const siblings = await database.shelves.where('roomId').equals(roomId).toArray();
    const shelf: Shelf = {
      id: newId(),
      roomId,
      name: name?.trim() || defaultShelfName(siblings.map((s) => s.name)),
      order: Math.max(0, ...siblings.map((s) => s.order + 1)),
      qrToken: newQrToken(),
    };
    await database.shelves.add(shelf);
    return shelf;
  });
}

// The shelf created last on « Pièces et étagères »: « Étagères » points it out when the user comes back.
let createdShelf: Id | undefined;

export function noteCreatedShelf(id: Id): void {
  createdShelf = id;
}

/** The shelf to point out, once. */
export function takeCreatedShelf(): Id | undefined {
  const id = createdShelf;
  createdShelf = undefined;
  return id;
}

/** A new room comes with its first shelf, « Étagère 1 ». */
export async function createRoom(name: string, database: LibraryDatabase = db): Promise<{ room: Room; shelf: Shelf }> {
  return database.transaction('rw', database.rooms, database.shelves, async () => {
    const rooms = await database.rooms.toArray();
    const room: Room = { id: newId(), name: name.trim(), order: Math.max(0, ...rooms.map((r) => r.order + 1)) };
    await database.rooms.add(room);
    const shelf = await createShelf(room.id, undefined, database);
    return { room, shelf };
  });
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');

/** Shelf of the given names (case ignored), created with its room when missing: used by the CSV import. */
export async function findOrCreateShelf(roomName: string, shelfName: string, database: LibraryDatabase = db): Promise<Shelf> {
  return database.transaction('rw', database.rooms, database.shelves, async () => {
    const rooms = await database.rooms.toArray();
    let room = rooms.find((r) => sameName(r.name, roomName));
    if (!room) {
      room = { id: newId(), name: roomName.trim(), order: Math.max(0, ...rooms.map((r) => r.order + 1)) };
      await database.rooms.add(room);
    }
    const shelves = await database.shelves.where('roomId').equals(room.id).toArray();
    return shelves.find((s) => sameName(s.name, shelfName)) ?? createShelf(room.id, shelfName, database);
  });
}

export async function renameRoom(id: Id, name: string, database: LibraryDatabase = db): Promise<void> {
  if (name.trim()) await database.rooms.update(id, { name: name.trim() });
}

export async function renameShelf(id: Id, name: string, database: LibraryDatabase = db): Promise<void> {
  if (name.trim()) await database.shelves.update(id, { name: name.trim() });
}

/** Removes a shelf only when no copy, pending item or read refers to it; its checks go with it. */
export async function deleteShelfIfEmpty(id: Id, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction('rw', [database.shelves, database.copies, database.pendingItems, database.shelfChecks], async () => {
    const used =
      (await database.copies.where('shelfId').equals(id).count()) +
      (await database.pendingItems.where('shelfId').equals(id).count());
    if (used > 0) return false;
    await database.shelfChecks.where('shelfId').equals(id).delete();
    await database.shelves.delete(id);
    return true;
  });
}

export async function deleteRoomIfEmpty(id: Id, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction(
    'rw',
    [database.rooms, database.shelves, database.copies, database.pendingItems, database.shelfChecks],
    async () => {
      const shelves = await database.shelves.where('roomId').equals(id).toArray();
      for (const shelf of shelves) {
        const used =
          (await database.copies.where('shelfId').equals(shelf.id).count()) +
          (await database.pendingItems.where('shelfId').equals(shelf.id).count());
        if (used > 0) return false;
      }
      const shelfIds = shelves.map((shelf) => shelf.id);
      await database.shelfChecks.where('shelfId').anyOf(shelfIds).delete();
      await database.shelves.bulkDelete(shelfIds);
      await database.rooms.delete(id);
      return true;
    },
  );
}

/** The shelf after this one in the same room, created (« Étagère N ») when it is the last. */
export async function nextShelf(shelfId: Id, database: LibraryDatabase = db): Promise<Shelf | undefined> {
  const shelf = await database.shelves.get(shelfId);
  if (!shelf) return undefined;
  const siblings = sortByOrder(await database.shelves.where('roomId').equals(shelf.roomId).toArray());
  const index = siblings.findIndex((s) => s.id === shelf.id);
  return siblings[index + 1] ?? createShelf(shelf.roomId, undefined, database);
}

export interface Place {
  room: Room;
  shelf: Shelf;
  /** « Salon · Étagère 2 » */
  label: string;
}

export interface PlaceIndex {
  rooms: Room[];
  shelvesByRoom: Map<Id, Shelf[]>;
  byShelfId: Map<Id, Place>;
}

/** Rooms and shelves sorted, with the label of every shelf. */
export function indexPlaces(rooms: readonly Room[], shelves: readonly Shelf[]): PlaceIndex {
  const sortedRooms = sortByOrder(rooms);
  const shelvesByRoom = new Map<Id, Shelf[]>();
  const byShelfId = new Map<Id, Place>();
  for (const room of sortedRooms) {
    const roomShelves = sortByOrder(shelves.filter((shelf) => shelf.roomId === room.id));
    shelvesByRoom.set(room.id, roomShelves);
    for (const shelf of roomShelves) byShelfId.set(shelf.id, { room, shelf, label: fr.places.label(room.name, shelf.name) });
  }
  return { rooms: sortedRooms, shelvesByRoom, byShelfId };
}

export async function loadPlaces(database: LibraryDatabase = db): Promise<PlaceIndex> {
  const [rooms, shelves] = await Promise.all([database.rooms.toArray(), database.shelves.toArray()]);
  return indexPlaces(rooms, shelves);
}
