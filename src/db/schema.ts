// Data model, as described in docs/SPEC.md (« Modèle de données »).
// Dates are stored as timestamps in milliseconds (Date.now()).

export type Id = string;
export type Timestamp = number;

export type MetadataProvider = 'googleBooks' | 'openLibrary' | 'bnf';

/** Where an automatic cover comes from: a metadata source, or a bookseller as a last resort. */
export type CoverProvider = MetadataProvider | 'amazon' | 'decitre';

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
  provider?: CoverProvider;
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
  /**
   * Sort key on its shelf, from left to right, only when « Mémoriser l’ordre sur l’étagère » is on:
   * the time of the read when scanned, renumbered by a shelf check (see shelves/order.ts).
   */
  position?: number;
  addedAt: Timestamp;
  note?: string;
  /** « Déclarer perdu » after a shelf check; cleared when the copy is seen or moved again. */
  lostAt?: Timestamp;
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
  /** Position of the copy to create on shelfId (order remembered), taken from the read. */
  position?: number;
}

export interface ScanSessionCounts {
  scanned: number;
  added: number;
  pending: number;
  extraCopies: number;
}

/**
 * One read of a scan session, in the « Cette session » list. Codes waiting for their metadata
 * (status searching) form the lookup queue, kept across restarts and network losses.
 */
export type ScanEntryStatus =
  | 'searching' // metadata lookup pending (also offline)
  | 'added' // new notice and its copy created
  | 'asking' // already owned: the « Ouvrage déjà possédé » dialog awaits an answer
  | 'extraCopy' // already owned: one more copy added
  | 'notAdded' // already owned: the user declined another copy
  | 'pending'; // sent to « À compléter » (unknown ISBN or no barcode)

export interface ScanEntry {
  id: Id;
  sessionId: Id;
  /** Shelf current when the code was read (a shelf QR code may change it afterwards). */
  shelfId: Id;
  kind: 'isbn' | 'noBarcode';
  isbn13?: string;
  status: ScanEntryStatus;
  bookId?: Id;
  /** Records created by this read, removed by « Annuler la dernière lecture ». */
  copyId?: Id;
  createdBook?: boolean;
  /** Number of the copy added (« 2ᵉ exemplaire »). */
  copyNumber?: number;
  pendingItemId?: Id;
  createdAt: Timestamp;
  /** Position given to the copy created by this read, when the order on the shelf is remembered. */
  position?: number;
}

export interface ScanSession {
  id: Id;
  shelfId: Id;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  counts: ScanSessionCounts;
}

/** One code read during a shelf check. */
export interface CheckRead {
  isbn13: string;
  at: Timestamp;
}

/** Comparison of the codes read with the library, made when the check ends. Ids are copy ids. */
export interface ShelfCheckResult {
  inPlace: Id[];
  /** Expected here and not read, not lent: « Introuvable ». */
  missing: Id[];
  /** Expected here, not read, lent: an expected absence. */
  lent: Id[];
  /** Read here although kept on another shelf: « Mal rangé ». */
  misplaced: { copyId: Id; shelfId: Id; position: number }[];
  /** Read here, not in the library (or a notice without any copy). */
  notOwned: { isbn13: string; bookId?: Id; position: number }[];
  /** Copies of books without an ISBN, which a scan cannot check. */
  unchecked: Id[];
}

export type CheckAnswer =
  | { kind: 'movedHere' } // « Le ranger désormais ici »
  | { kind: 'toPutBack' } // « Le remettre à sa place »
  | { kind: 'movedTo'; shelfId: Id } // « Il est rangé ailleurs »
  | { kind: 'lost' } // « Déclarer perdu »
  | { kind: 'added' }; // « L’ajouter à cette étagère »

/** « Vérifier cette étagère » (lot 3, screen 8): the codes read on the shelf, then the comparison. */
export interface ShelfCheck {
  id: Id;
  shelfId: Id;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  /** In the order of reading, i.e. from left to right. */
  reads: CheckRead[];
  result?: ShelfCheckResult;
  /** Answers to the results, by copy id (or ISBN for a book not in the library). */
  answers?: Record<string, CheckAnswer>;
  /** Hidden from the shelf view by the user. */
  dismissed?: boolean;
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
  /** An enabled source did not answer (network, quota, timeout): fields or covers may be missing. Never cached. */
  incomplete?: boolean;
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
  /** Clé Google Books of the user (empty: none). Kept on the device only, never in the repository. */
  googleBooksKey: string;
}

export const SETTINGS_KEY = 'app';

export type BackupError = 'offline' | 'refused' | 'failed';

/**
 * Sauvegarde automatique sur Google Drive (lot 2). The client and its secret are created by the user
 * in the Google Cloud console and typed in the app: kept on the device only, never in the repository.
 * Not part of the backup itself.
 */
export interface BackupState {
  id: 'drive';
  clientId: string;
  clientSecret: string;
  /** Present once the user has signed in; Google may revoke it (lastError « refused »). */
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: Timestamp;
  /** PKCE verifier and state while the user signs in on Google's page. */
  pendingSignIn?: { verifier: string; state: string };
  enabled: boolean;
  lastBackupAt?: Timestamp;
  /** Fingerprint of the last uploaded backup: an unchanged library is not uploaded again. */
  lastHash?: string;
  lastError?: BackupError;
}

export interface SettingsRecord extends Partial<Omit<Settings, 'sources'>> {
  id: typeof SETTINGS_KEY;
  sources?: Partial<Record<MetadataProvider, boolean>>;
}
