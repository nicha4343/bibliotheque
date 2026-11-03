import Dexie, { type EntityTable } from 'dexie';
import type {
  BackupState,
  Book,
  Copy,
  Loan,
  MetadataCacheEntry,
  PendingItem,
  Quote,
  Room,
  ScanEntry,
  ScanSession,
  SettingsRecord,
  Shelf,
  ShelfCheck,
  StoredBlob,
  Wish,
} from './schema';
import { DATABASE_NAME } from './schema';

export { DATABASE_NAME };

export class LibraryDatabase extends Dexie {
  rooms!: EntityTable<Room, 'id'>;
  shelves!: EntityTable<Shelf, 'id'>;
  books!: EntityTable<Book, 'id'>;
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
  }
}

export const db = new LibraryDatabase();
