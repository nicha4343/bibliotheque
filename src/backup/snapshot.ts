import { splitReading } from '../books/readings';
import { db, firstSite, type LibraryDatabase } from '../db/db';
import type {
  Book,
  Copy,
  Id,
  Loan,
  PendingItem,
  Quote,
  Reading,
  Room,
  SeriesRecord,
  SettingsRecord,
  Shelf,
  Site,
  Wish,
} from '../db/schema';

// Contents of a backup: every record the user made, the photographs being saved as separate files.
// Left out: the metadata cache, the scan sessions and the shelf checks (rebuilt or short-lived), the
// backup state.

export const SNAPSHOT_FORMAT = 'ma-bibliotheque';
/**
 * 2: loans (lot 4); 3: wishes and series (lot 5); 4: places (lot 10); 5: readings apart from the notices
 * (lot 12). An older backup is read as having none of them, its rooms joining a first place and the
 * readings leaving its notices.
 */
export const SNAPSHOT_VERSION = 5;

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  createdAt: number;
  sites: Site[];
  rooms: Room[];
  shelves: Shelf[];
  books: Book[];
  readings: Reading[];
  copies: Copy[];
  pendingItems: PendingItem[];
  quotes: Quote[];
  loans: Loan[];
  wishes: Wish[];
  series: SeriesRecord[];
  settings: SettingsRecord[];
  /** Photographs (covers, books without a barcode, quotes), each saved as photo-<id>.jpg. */
  blobIds: Id[];
}

const byId = <T extends { id: string }>(records: T[]): T[] => records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export async function buildSnapshot(database: LibraryDatabase = db, now = Date.now()): Promise<Snapshot> {
  return database.transaction(
    'r',
    [
      database.sites,
      database.rooms,
      database.shelves,
      database.books,
      database.readings,
      database.copies,
      database.pendingItems,
      database.quotes,
      database.loans,
      database.wishes,
      database.series,
      database.settings,
      database.blobs,
    ],
    async () => ({
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: now,
      sites: byId(await database.sites.toArray()),
      rooms: byId(await database.rooms.toArray()),
      shelves: byId(await database.shelves.toArray()),
      books: byId(await database.books.toArray()),
      readings: (await database.readings.toArray()).sort((a, b) => (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0)),
      copies: byId(await database.copies.toArray()),
      pendingItems: byId(await database.pendingItems.toArray()),
      quotes: byId(await database.quotes.toArray()),
      loans: byId(await database.loans.toArray()),
      wishes: byId(await database.wishes.toArray()),
      series: byId(await database.series.toArray()),
      settings: await database.settings.toArray(),
      blobIds: (await database.blobs.toCollection().primaryKeys()).sort(),
    }),
  );
}

/** Fingerprint of the contents, its date aside: an unchanged library is not uploaded again. */
export async function snapshotHash(snapshot: Snapshot): Promise<string> {
  const { createdAt: _createdAt, ...contents } = snapshot;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(contents)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const LISTS = ['sites', 'rooms', 'shelves', 'books', 'readings', 'copies', 'pendingItems', 'quotes', 'loans', 'wishes', 'series', 'settings', 'blobIds'] as const;

/** A file read from Drive, checked before it replaces anything. */
export function parseSnapshot(text: string): Snapshot | undefined {
  try {
    const value = JSON.parse(text) as Partial<Snapshot> | null;
    if (typeof value?.version === 'number' && value.version < 2) value.loans ??= [];
    if (typeof value?.version === 'number' && value.version < 3) {
      value.wishes ??= [];
      value.series ??= [];
    }
    if (typeof value?.version === 'number' && value.version < 4) value.sites ??= [];
    if (typeof value?.version === 'number' && value.version < 5) {
      const readings: Reading[] = [];
      if (Array.isArray(value.books)) {
        value.books = value.books.map((stored) => {
          const { book, reading } = splitReading(stored);
          if (reading) readings.push(reading);
          return book;
        });
      }
      value.readings ??= readings;
    }
    if (value?.format !== SNAPSHOT_FORMAT || typeof value.version !== 'number' || value.version > SNAPSHOT_VERSION)
      return undefined;
    if (typeof value.createdAt !== 'number' || !LISTS.every((key) => Array.isArray(value[key]))) return undefined;
    return value as Snapshot;
  } catch {
    return undefined;
  }
}

/** The places of a backup, with a first one for a backup made before them; every room in one of them. */
export function siteRecords(snapshot: Pick<Snapshot, 'sites' | 'rooms'>): { sites: Site[]; rooms: Room[] } {
  const sites = snapshot.sites.length > 0 ? snapshot.sites : [firstSite()];
  const known = new Set(sites.map((site) => site.id));
  const first = [...sites].sort((a, b) => a.order - b.order)[0]?.id ?? '';
  return { sites, rooms: snapshot.rooms.map((room) => (known.has(room.siteId) ? room : { ...room, siteId: first })) };
}

/**
 * Replaces the library of this device with the backup, in one transaction: on failure nothing changes.
 * The photographs must already be in the blobs table; those the backup does not use are removed.
 */
export async function restoreSnapshot(snapshot: Snapshot, database: LibraryDatabase = db): Promise<void> {
  const tables = [
    database.sites,
    database.rooms,
    database.shelves,
    database.books,
    database.readings,
    database.copies,
    database.pendingItems,
    database.quotes,
    database.loans,
    database.wishes,
    database.series,
    database.settings,
    database.blobs,
    database.scanSessions,
    database.scanEntries,
    database.shelfChecks,
  ];
  await database.transaction('rw', tables, async () => {
    // Scan sessions and shelf checks refer to the shelves, copies and items replaced here.
    await Promise.all([database.scanSessions.clear(), database.scanEntries.clear(), database.shelfChecks.clear()]);
    const { sites, rooms } = siteRecords(snapshot);
    await database.sites.clear();
    await database.sites.bulkAdd(sites);
    await database.rooms.clear();
    await database.rooms.bulkAdd(rooms);
    await database.shelves.clear();
    await database.shelves.bulkAdd(snapshot.shelves);
    await database.books.clear();
    await database.books.bulkAdd(snapshot.books);
    await database.readings.clear();
    await database.readings.bulkAdd(snapshot.readings);
    await database.copies.clear();
    await database.copies.bulkAdd(snapshot.copies);
    await database.pendingItems.clear();
    await database.pendingItems.bulkAdd(snapshot.pendingItems);
    await database.quotes.clear();
    await database.quotes.bulkAdd(snapshot.quotes);
    await database.loans.clear();
    await database.loans.bulkAdd(snapshot.loans);
    await database.wishes.clear();
    await database.wishes.bulkAdd(snapshot.wishes);
    await database.series.clear();
    await database.series.bulkAdd(snapshot.series);
    await database.settings.clear();
    await database.settings.bulkAdd(snapshot.settings);
    const kept = new Set(snapshot.blobIds);
    const local = await database.blobs.toCollection().primaryKeys();
    await database.blobs.bulkDelete(local.filter((id) => !kept.has(id)));
  });
}
