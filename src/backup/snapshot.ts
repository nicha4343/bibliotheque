import { db, type LibraryDatabase } from '../db/db';
import type { Book, Copy, Id, Loan, PendingItem, Quote, Room, SettingsRecord, Shelf } from '../db/schema';

// Contents of a backup: every record the user made, the photographs being saved as separate files.
// Left out: the metadata cache, the scan sessions and the shelf checks (rebuilt or short-lived), the
// backup state.

export const SNAPSHOT_FORMAT = 'ma-bibliotheque';
/** 2: loans (lot 4). A version 1 backup is read as having no loans. */
export const SNAPSHOT_VERSION = 2;

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  createdAt: number;
  rooms: Room[];
  shelves: Shelf[];
  books: Book[];
  copies: Copy[];
  pendingItems: PendingItem[];
  quotes: Quote[];
  loans: Loan[];
  settings: SettingsRecord[];
  /** Photographs (covers, books without a barcode, quotes), each saved as photo-<id>.jpg. */
  blobIds: Id[];
}

const byId = <T extends { id: string }>(records: T[]): T[] => records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export async function buildSnapshot(database: LibraryDatabase = db, now = Date.now()): Promise<Snapshot> {
  return database.transaction(
    'r',
    [
      database.rooms,
      database.shelves,
      database.books,
      database.copies,
      database.pendingItems,
      database.quotes,
      database.loans,
      database.settings,
      database.blobs,
    ],
    async () => ({
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: now,
      rooms: byId(await database.rooms.toArray()),
      shelves: byId(await database.shelves.toArray()),
      books: byId(await database.books.toArray()),
      copies: byId(await database.copies.toArray()),
      pendingItems: byId(await database.pendingItems.toArray()),
      quotes: byId(await database.quotes.toArray()),
      loans: byId(await database.loans.toArray()),
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

const LISTS = ['rooms', 'shelves', 'books', 'copies', 'pendingItems', 'quotes', 'loans', 'settings', 'blobIds'] as const;

/** A file read from Drive, checked before it replaces anything. */
export function parseSnapshot(text: string): Snapshot | undefined {
  try {
    const value = JSON.parse(text) as Partial<Snapshot> | null;
    if (value?.version === 1) value.loans ??= [];
    if (value?.format !== SNAPSHOT_FORMAT || typeof value.version !== 'number' || value.version > SNAPSHOT_VERSION)
      return undefined;
    if (typeof value.createdAt !== 'number' || !LISTS.every((key) => Array.isArray(value[key]))) return undefined;
    return value as Snapshot;
  } catch {
    return undefined;
  }
}

/**
 * Replaces the library of this device with the backup, in one transaction: on failure nothing changes.
 * The photographs must already be in the blobs table; those the backup does not use are removed.
 */
export async function restoreSnapshot(snapshot: Snapshot, database: LibraryDatabase = db): Promise<void> {
  const tables = [
    database.rooms,
    database.shelves,
    database.books,
    database.copies,
    database.pendingItems,
    database.quotes,
    database.loans,
    database.settings,
    database.blobs,
    database.scanSessions,
    database.scanEntries,
    database.shelfChecks,
  ];
  await database.transaction('rw', tables, async () => {
    // Scan sessions and shelf checks refer to the shelves, copies and items replaced here.
    await Promise.all([database.scanSessions.clear(), database.scanEntries.clear(), database.shelfChecks.clear()]);
    await database.rooms.clear();
    await database.rooms.bulkAdd(snapshot.rooms);
    await database.shelves.clear();
    await database.shelves.bulkAdd(snapshot.shelves);
    await database.books.clear();
    await database.books.bulkAdd(snapshot.books);
    await database.copies.clear();
    await database.copies.bulkAdd(snapshot.copies);
    await database.pendingItems.clear();
    await database.pendingItems.bulkAdd(snapshot.pendingItems);
    await database.quotes.clear();
    await database.quotes.bulkAdd(snapshot.quotes);
    await database.loans.clear();
    await database.loans.bulkAdd(snapshot.loans);
    await database.settings.clear();
    await database.settings.bulkAdd(snapshot.settings);
    const kept = new Set(snapshot.blobIds);
    const local = await database.blobs.toCollection().primaryKeys();
    await database.blobs.bulkDelete(local.filter((id) => !kept.has(id)));
  });
}
