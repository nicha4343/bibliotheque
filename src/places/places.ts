import { deleteBooks } from '../books/books';
import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Copy, Id, Room, ScanEntry, Shelf, Site } from '../db/schema';
import { isActive } from '../loans/dates';
import { deleteLoansOf } from '../loans/loans';
import { endSession } from '../scan/session';
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

const nextOrder = (items: readonly { order: number }[]) => Math.max(0, ...items.map((item) => item.order + 1));

export async function createShelf(roomId: Id, name?: string, database: LibraryDatabase = db): Promise<Shelf> {
  return database.transaction('rw', database.shelves, async () => {
    const siblings = await database.shelves.where('roomId').equals(roomId).toArray();
    const shelf: Shelf = {
      id: newId(),
      roomId,
      name: name?.trim() || defaultShelfName(siblings.map((s) => s.name)),
      order: nextOrder(siblings),
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

/** The first place by order, created (« Maison ») if the library has none: rooms always belong to one. */
async function defaultSite(database: LibraryDatabase): Promise<Site> {
  const first = sortByOrder(await database.sites.toArray())[0];
  if (first) return first;
  const site: Site = { id: newId(), name: fr.sites.defaultName, order: 0 };
  await database.sites.add(site);
  return site;
}

export async function createSite(name: string, database: LibraryDatabase = db): Promise<Site> {
  return database.transaction('rw', database.sites, async () => {
    const site: Site = { id: newId(), name: name.trim(), order: nextOrder(await database.sites.toArray()) };
    await database.sites.add(site);
    return site;
  });
}

export async function renameSite(id: Id, name: string, database: LibraryDatabase = db): Promise<void> {
  if (name.trim()) await database.sites.update(id, { name: name.trim() });
}

/** A new room comes with its first shelf, « Étagère 1 »; it goes to the first place when none is given. */
export async function createRoom(name: string, database: LibraryDatabase = db, siteId?: Id): Promise<{ room: Room; shelf: Shelf }> {
  return database.transaction('rw', database.sites, database.rooms, database.shelves, async () => {
    const room: Room = {
      id: newId(),
      siteId: siteId ?? (await defaultSite(database)).id,
      name: name.trim(),
      order: nextOrder(await database.rooms.toArray()),
    };
    await database.rooms.add(room);
    const shelf = await createShelf(room.id, undefined, database);
    return { room, shelf };
  });
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');

/**
 * Shelf of the given names (case ignored), created with its room and place when missing: used by the
 * CSV import. Without a place, the room is looked for in every place, then created in the first one.
 */
export async function findOrCreateShelf(
  roomName: string,
  shelfName: string,
  database: LibraryDatabase = db,
  siteName?: string,
): Promise<Shelf> {
  return database.transaction('rw', database.sites, database.rooms, database.shelves, async () => {
    const sites = sortByOrder(await database.sites.toArray());
    const named = siteName?.trim() ? siteName : undefined;
    const site = named === undefined ? undefined : (sites.find((s) => sameName(s.name, named)) ?? (await createSite(named, database)));
    const rooms = await database.rooms.toArray();
    const rank = (room: Room) => {
      const index = sites.findIndex((s) => s.id === room.siteId);
      return index < 0 ? sites.length : index;
    };
    const room =
      rooms.filter((r) => sameName(r.name, roomName) && (!site || r.siteId === site.id)).sort((a, b) => rank(a) - rank(b))[0] ??
      (await addRoom(roomName, (site ?? (await defaultSite(database))).id, nextOrder(rooms), database));
    const shelves = await database.shelves.where('roomId').equals(room.id).toArray();
    return shelves.find((s) => sameName(s.name, shelfName)) ?? createShelf(room.id, shelfName, database);
  });
}

async function addRoom(name: string, siteId: Id, order: number, database: LibraryDatabase): Promise<Room> {
  const room: Room = { id: newId(), siteId, name: name.trim(), order };
  await database.rooms.add(room);
  return room;
}

export async function renameRoom(id: Id, name: string, database: LibraryDatabase = db): Promise<void> {
  if (name.trim()) await database.rooms.update(id, { name: name.trim() });
}

/** Moves a room, with its shelves and their books, to another place. */
export async function moveRoom(id: Id, siteId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.rooms.update(id, { siteId });
}

export async function renameShelf(id: Id, name: string, database: LibraryDatabase = db): Promise<void> {
  if (name.trim()) await database.shelves.update(id, { name: name.trim() });
}

/** A place, a room or a shelf, as deleted from « Pièces et étagères ». */
export type PlaceKind = 'site' | 'room' | 'shelf';

/** What deleting a place, a room or a shelf takes with it, told before (a warning when it is not empty). */
export interface PlaceContents {
  /** Copies on its shelves. */
  copies: number;
  /** Notices whose every copy is there: they leave the library. */
  books: number;
  /** Notices that keep a copy elsewhere. */
  kept: number;
  /** Copies lent at the moment: their loans go with them. */
  lent: number;
  /** Read but not recorded yet: items to complete, codes being searched or awaiting an answer. */
  waiting: number;
}

export const isEmptyPlace = (contents: PlaceContents): boolean => contents.copies + contents.waiting === 0;

async function shelfIdsOf(kind: PlaceKind, id: Id, database: LibraryDatabase): Promise<Id[]> {
  if (kind === 'shelf') return [id];
  const roomIds = kind === 'room' ? [id] : await database.rooms.where('siteId').equals(id).primaryKeys();
  return database.shelves.where('roomId').anyOf(roomIds).primaryKeys();
}

// Codes read on these shelves and not recorded yet: their search, or the answer awaited, would put a copy there.
async function waitingEntries(shelfIds: readonly Id[], database: LibraryDatabase): Promise<ScanEntry[]> {
  const shelves = new Set(shelfIds);
  const entries = await database.scanEntries.where('status').anyOf(['searching', 'asking']).toArray();
  return entries.filter((entry) => shelves.has(entry.shelfId));
}

/** The copies of these shelves, and the notices among theirs that have no copy anywhere else. */
async function copiesOn(shelfIds: readonly Id[], database: LibraryDatabase): Promise<{ copies: Copy[]; leaving: Set<Id> }> {
  const copies = await database.copies.where('shelfId').anyOf([...shelfIds]).toArray();
  const here = new Set(copies.map((copy) => copy.id));
  const leaving = new Set(copies.map((copy) => copy.bookId));
  const all = await database.copies.where('bookId').anyOf([...leaving]).toArray();
  for (const copy of all) if (!here.has(copy.id)) leaving.delete(copy.bookId);
  return { copies, leaving };
}

export async function placeContents(kind: PlaceKind, id: Id, database: LibraryDatabase = db): Promise<PlaceContents> {
  const tables = [database.rooms, database.shelves, database.copies, database.loans, database.pendingItems, database.scanEntries];
  return database.transaction('r', tables, async () => {
    const shelfIds = await shelfIdsOf(kind, id, database);
    const { copies, leaving } = await copiesOn(shelfIds, database);
    const loans = await database.loans.where('copyId').anyOf(copies.map((copy) => copy.id)).toArray();
    return {
      copies: copies.length,
      books: leaving.size,
      kept: new Set(copies.map((copy) => copy.bookId)).size - leaving.size,
      lent: new Set(loans.filter(isActive).map((loan) => loan.copyId)).size,
      waiting:
        (await database.pendingItems.where('shelfId').anyOf(shelfIds).count()) + (await waitingEntries(shelfIds, database)).length,
    };
  });
}

const deletionTables = (database: LibraryDatabase) => [
  database.sites,
  database.rooms,
  database.shelves,
  database.books,
  database.readings,
  database.copies,
  database.loans,
  database.quotes,
  database.blobs,
  database.pendingItems,
  database.scanSessions,
  database.scanEntries,
  database.shelfChecks,
];

/**
 * Removes shelves with everything on them: their copies and their loans (a notice whose every copy was
 * there leaves the library, see deleteBooks), items to complete, checks, codes read but not recorded.
 * A scan session open on one of them ends: the next scan asks where to put the books.
 */
async function deleteShelves(shelfIds: readonly Id[], database: LibraryDatabase): Promise<void> {
  const ids = [...shelfIds];
  const { copies, leaving } = await copiesOn(ids, database);
  await deleteBooks([...leaving], database);
  const others = copies.filter((copy) => !leaving.has(copy.bookId)).map((copy) => copy.id);
  await deleteLoansOf(others, database);
  await database.copies.bulkDelete(others);

  const items = await database.pendingItems.where('shelfId').anyOf(ids).toArray();
  await database.blobs.bulkDelete(items.flatMap((item) => (item.photoBlobId ? [item.photoBlobId] : [])));
  await database.pendingItems.bulkDelete(items.map((item) => item.id));
  await database.scanEntries.bulkDelete((await waitingEntries(ids, database)).map((entry) => entry.id));
  for (const session of await database.scanSessions.where('shelfId').anyOf(ids).toArray()) {
    if (session.endedAt === undefined) await endSession(session.id, database);
  }
  await database.shelfChecks.where('shelfId').anyOf(ids).delete();
  await database.shelves.bulkDelete(ids);
}

/** Removes a shelf and everything on it (deleteShelves); its QR label is no longer recognised. */
export async function deleteShelf(id: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', deletionTables(database), () => deleteShelves([id], database));
}

/** Removes a room, its shelves and everything on them. */
export async function deleteRoom(id: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', deletionTables(database), async () => {
    await deleteShelves(await shelfIdsOf('room', id, database), database);
    await database.rooms.delete(id);
  });
}

/** Removes a place, its rooms, their shelves and everything on them; never the last place. */
export async function deleteSite(id: Id, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction('rw', deletionTables(database), async () => {
    if ((await database.sites.count()) < 2) return false;
    // Lot 13: a shared place stops being shared first, its Drive file going with it.
    if ((await database.sites.get(id))?.share) return false;
    await deleteShelves(await shelfIdsOf('site', id, database), database);
    await database.rooms.where('siteId').equals(id).delete();
    await database.sites.delete(id);
    return true;
  });
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
  site: Site;
  room: Room;
  shelf: Shelf;
  /** « Salon · Étagère 2 », preceded by the place when there are several: « Maison · Salon · Étagère 2 ». */
  label: string;
  /** « Salon · Étagère 2 », where the place is shown apart. */
  roomLabel: string;
}

export interface PlaceIndex {
  sites: Site[];
  /** The library has several places: their names are shown. */
  severalSites: boolean;
  /** Every room, place by place. */
  rooms: Room[];
  roomsBySite: Map<Id, Room[]>;
  siteOfRoom: Map<Id, Site>;
  shelvesByRoom: Map<Id, Shelf[]>;
  byShelfId: Map<Id, Place>;
}

/** Places, rooms and shelves sorted, with the label of every shelf. */
export function indexPlaces(sites: readonly Site[], rooms: readonly Room[], shelves: readonly Shelf[]): PlaceIndex {
  const sortedSites = sortByOrder(sites);
  // Never expected (there is always a place), but a room must not vanish with its books.
  const fallback = sortedSites[0] ?? { id: '', name: fr.sites.defaultName, order: 0 };
  if (sortedSites.length === 0 && rooms.length > 0) sortedSites.push(fallback);
  const known = new Set(sortedSites.map((site) => site.id));
  const severalSites = sortedSites.length > 1;
  const roomsBySite = new Map<Id, Room[]>(sortedSites.map((site) => [site.id, []]));
  for (const room of sortByOrder(rooms)) roomsBySite.get(known.has(room.siteId) ? room.siteId : fallback.id)?.push(room);

  const siteOfRoom = new Map<Id, Site>();
  const shelvesByRoom = new Map<Id, Shelf[]>();
  const byShelfId = new Map<Id, Place>();
  for (const site of sortedSites) {
    for (const room of roomsBySite.get(site.id) ?? []) {
      siteOfRoom.set(room.id, site);
      const roomShelves = sortByOrder(shelves.filter((shelf) => shelf.roomId === room.id));
      shelvesByRoom.set(room.id, roomShelves);
      for (const shelf of roomShelves) {
        const roomLabel = fr.places.label(room.name, shelf.name);
        const label = severalSites ? fr.places.label(site.name, roomLabel) : roomLabel;
        byShelfId.set(shelf.id, { site, room, shelf, label, roomLabel });
      }
    }
  }
  return {
    sites: sortedSites,
    severalSites,
    rooms: sortedSites.flatMap((site) => roomsBySite.get(site.id) ?? []),
    roomsBySite,
    siteOfRoom,
    shelvesByRoom,
    byShelfId,
  };
}

/** « Salon », preceded by its place when there are several: « Maison · Salon ». */
export function roomWithSite(places: PlaceIndex, room: Room): string {
  const site = places.siteOfRoom.get(room.id);
  return places.severalSites && site ? fr.places.label(site.name, room.name) : room.name;
}

export async function loadPlaces(database: LibraryDatabase = db): Promise<PlaceIndex> {
  const [sites, rooms, shelves] = await Promise.all([database.sites.toArray(), database.rooms.toArray(), database.shelves.toArray()]);
  return indexPlaces(sites, rooms, shelves);
}

// The place shown on « Étagères » and « Pièces et étagères », kept from one screen to the other and,
// on this device, from one day to the next.
const SHOWN_SITE_KEY = 'bibliotheque.site';
let shownSite: Id | undefined;

export function rememberShownSite(id: Id): void {
  shownSite = id;
  try {
    localStorage.setItem(SHOWN_SITE_KEY, id);
  } catch {
    // Storage refused (private browsing): remembered while the application stays open.
  }
}

/** The place to show: the one shown last, or the first. */
export function shownSiteOf(places: PlaceIndex): Site | undefined {
  if (shownSite === undefined) {
    try {
      shownSite = localStorage.getItem(SHOWN_SITE_KEY) ?? undefined;
    } catch {
      shownSite = undefined;
    }
  }
  return places.sites.find((site) => site.id === shownSite) ?? places.sites[0];
}
