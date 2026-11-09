import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { splitReading } from '../books/readings';
import { fr } from '../textes/fr';
import { newId } from './ids';
import type {
  BackupState,
  Book,
  Copy,
  Loan,
  MetadataCacheEntry,
  PendingItem,
  Quote,
  Reading,
  Room,
  ScanEntry,
  ScanSession,
  SeriesRecord,
  SettingsRecord,
  SharedPhoto,
  SharedPlace,
  Shelf,
  ShelfCheck,
  ShareUpload,
  Site,
  StoredBlob,
  Wish,
} from './schema';
import { DATABASE_NAME } from './schema';

export { DATABASE_NAME };

/** The first place, which the rooms of a library made before the places join. */
export const firstSite = (): Site => ({ id: newId(), name: fr.sites.defaultName, order: 0 });

async function addFirstSite(tx: Transaction): Promise<void> {
  const site = firstSite();
  await tx.table('sites').add(site);
  await tx.table('rooms').toCollection().modify({ siteId: site.id });
}

/** Lot 12: status, rating and review leave the notices; only a reading worth keeping gets a record. */
async function moveReadings(tx: Transaction): Promise<void> {
  const readings: Reading[] = [];
  await tx
    .table<Book>('books')
    .toCollection()
    .modify((stored, ref) => {
      const { book, reading } = splitReading(stored);
      ref.value = book;
      if (reading) readings.push(reading);
    });
  await tx.table('readings').bulkAdd(readings);
}

export class LibraryDatabase extends Dexie {
  sites!: EntityTable<Site, 'id'>;
  rooms!: EntityTable<Room, 'id'>;
  shelves!: EntityTable<Shelf, 'id'>;
  books!: EntityTable<Book, 'id'>;
  readings!: EntityTable<Reading, 'bookId'>;
  copies!: EntityTable<Copy, 'id'>;
  pendingItems!: EntityTable<PendingItem, 'id'>;
  scanSessions!: EntityTable<ScanSession, 'id'>;
  scanEntries!: EntityTable<ScanEntry, 'id'>;
  loans!: EntityTable<Loan, 'id'>;
  wishes!: EntityTable<Wish, 'id'>;
  quotes!: EntityTable<Quote, 'id'>;
  metadataCache!: EntityTable<MetadataCacheEntry, 'isbn13'>;
  blobs!: EntityTable<StoredBlob, 'id'>;
  settings!: EntityTable<SettingsRecord, 'id'>;
  backup!: EntityTable<BackupState, 'id'>;
  shelfChecks!: EntityTable<ShelfCheck, 'id'>;
  series!: EntityTable<SeriesRecord, 'id'>;
  shareUploads!: EntityTable<ShareUpload, 'fileId'>;
  sharedPlaces!: EntityTable<SharedPlace, 'fileId'>;
  sharedPhotos!: EntityTable<SharedPhoto, 'id'>;

  constructor(name = DATABASE_NAME) {
    super(name);
    // Only indexed fields are listed. Never edit a published version: add version(2) with the changes.
    this.version(1).stores({
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
    });
    // Lot 1: reads of a scan session, which also form the lookup queue.
    this.version(2).stores({
      scanEntries: 'id, sessionId, status, createdAt',
    });
    // Lot 2: Google Drive backup state (client, tokens, last backup).
    this.version(3).stores({
      backup: 'id',
    });
    // Lot 3: shelf checks. Copy.position and Copy.lostAt are not indexed: no other change.
    this.version(4).stores({
      shelfChecks: 'id, shelfId, startedAt',
    });
    // Lot 5: number of volumes of a series. Book.price and the new Wish fields are not indexed.
    this.version(5).stores({
      series: 'id',
    });
    // Lot 10: places (lieux) above the rooms; the existing rooms join a first place, « Maison ».
    this.version(6)
      .stores({
        sites: 'id',
        rooms: 'id, order, siteId',
      })
      .upgrade(addFirstSite);
    // Lot 12: « Ma lecture » apart from the notice, each person keeping their own in a shared place.
    this.version(7)
      .stores({
        books: 'id, &isbn13, createdAt, *tags',
        readings: 'bookId',
      })
      .upgrade(moveReadings);
    // Lot 13: places shared with relatives. Site.share is not indexed; the owner's uploads, and on a
    // guest's device the places shared with them and their pictures, are kept apart from the library.
    this.version(8).stores({
      shareUploads: 'fileId',
      sharedPlaces: 'fileId',
      sharedPhotos: 'id, fileId',
    });
    // A new library also starts with its first place.
    this.on('populate', (tx) => addFirstSite(tx));
  }
}

export const db = new LibraryDatabase();
