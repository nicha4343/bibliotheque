// Data model, as described in docs/SPEC.md (« Modèle de données »).
// Dates are stored as timestamps in milliseconds (Date.now()).

export type Id = string;
export type Timestamp = number;

export type MetadataProvider = 'googleBooks' | 'openLibrary' | 'bnf';

/** Pièce. */
export interface Room {
  id: Id;
  name: string;
  order: number;
}

/** Étagère. */
export interface Shelf {
  id: Id;
  roomId: Id;
  name: string;
  order: number;
  /** Encoded in the shelf's printed QR code. */
  qrToken: string;
}

export type ReadingStatus = 'toread' | 'read';

export interface Cover {
  /** A user photograph always wins over an automatic cover and is never overwritten by one. */
  source: 'auto' | 'user';
  url?: string;
  blobId?: Id;
  provider?: MetadataProvider;
}

/** Notice d'ouvrage; its physical copies are Copy records. */
export interface Book {
  id: Id;
  /** Missing only for a book without a barcode, completed by hand. */
  isbn13?: string;
  isbn10?: string;
  title: string;
  authors: string[];
  publisher?: string;
  year?: number;
  language?: string;
  seriesName?: string;
  seriesIndex?: number;
  cover?: Cover;
  status: ReadingStatus;
  /** 0 = not rated, otherwise 1 to 5. */
  rating: number;
  review: string;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Exemplaire. */
export interface Copy {
  id: Id;
  bookId: Id;
  shelfId: Id;
  /** Left-to-right position, only when the « Mémoriser l’ordre sur l’étagère » option is on. */
  position?: number;
  addedAt: Timestamp;
  note?: string;
}

/** Élément « À compléter ». */
export interface PendingItem {
  id: Id;
  kind: 'unknownIsbn' | 'noBarcode';
  isbn?: string;
  photoBlobId?: Id;
  shelfId: Id;
  sessionId: Id;
  createdAt: Timestamp;
}

export interface ScanSessionCounts {
  scanned: number;
  added: number;
  pending: number;
  extraCopies: number;
}

export interface ScanSession {
  id: Id;
  shelfId: Id;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  counts: ScanSessionCounts;
}

/** Prêt (lot 4). */
export interface Loan {
  id: Id;
  copyId: Id;
  borrower: string;
  lentAt: Timestamp;
  dueAt: Timestamp;
  returnedAt?: Timestamp;
}

/** Souhait (lot 5). */
export interface Wish {
  id: Id;
  title: string;
  author?: string;
  isbn?: string;
  source: 'series' | 'manual';
}

/** Citation (lot 2). */
export interface Quote {
  id: Id;
  bookId: Id;
  text: string;
  photoBlobId?: Id;
  createdAt: Timestamp;
}

/** Metadata merged from the sources for one ISBN; refined in lot 1. */
export interface BookMetadata {
  isbn13: string;
  isbn10?: string;
  title?: string;
  authors?: string[];
  publisher?: string;
  year?: number;
  language?: string;
  seriesName?: string;
  seriesIndex?: number;
  coverUrls?: { provider: MetadataProvider; url: string }[];
  /** Sources that answered; empty when the ISBN is unknown everywhere. */
  providers: MetadataProvider[];
}

export interface MetadataCacheEntry {
  isbn13: string;
  payload: BookMetadata;
  fetchedAt: Timestamp;
}

/** Photographs (covers, books without a barcode, quotes), stored as compressed JPEG. */
export interface StoredBlob {
  id: Id;
  blob: Blob;
  createdAt: Timestamp;
}

/** Paramètres (screen 7). */
export interface Settings {
  /** Signal sonore. */
  scanSound: boolean;
  /** Vibration (absent on iPhone). */
  scanVibration: boolean;
  /** Signaler les ouvrages déjà possédés. */
  flagOwnedBooks: boolean;
  /** Mémoriser l’ordre sur l’étagère: off by default. */
  rememberShelfOrder: boolean;
  /** Couvertures automatiques. */
  autoCovers: boolean;
  /** Sources, interrogées simultanément. */
  sources: Record<MetadataProvider, boolean>;
  /** Lecture hors connexion: keep scanned codes and search them once the network is back. */
  offlineScanning: boolean;
}

export const SETTINGS_KEY = 'app';

export interface SettingsRecord extends Partial<Omit<Settings, 'sources'>> {
  id: typeof SETTINGS_KEY;
  sources?: Partial<Record<MetadataProvider, boolean>>;
}
