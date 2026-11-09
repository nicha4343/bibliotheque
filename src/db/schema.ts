// Data model, as described in docs/SPEC.md (« Modèle de données »).
// Dates are stored as timestamps in milliseconds (Date.now()).

/** Name of the IndexedDB database, also opened by the service worker (loan reminders). */
export const DATABASE_NAME = 'ma-bibliotheque';

export type Id = string;
export type Timestamp = number;

export type MetadataProvider = 'googleBooks' | 'openLibrary' | 'bnf';

/** Where an automatic cover comes from: a metadata source, or a bookseller as a last resort. */
export type CoverProvider = MetadataProvider | 'amazon' | 'decitre';

/** Lieu (lot 10): « Maison », « Maison de campagne »; every room belongs to one, and there is always one. */
export interface Site {
  id: Id;
  name: string;
  order: number;
}

/** Pièce. */
export interface Room {
  id: Id;
  /** Lieu of the room. */
  siteId: Id;
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
  /**
   * Given by a source, an import or the user. Absent: read from the title when it names a volume
   * (« Blake et Mortimer - Tome 1 », see series/series.ts); empty: the user took the book out of any series.
   */
  seriesName?: string;
  seriesIndex?: number;
  /** The BnF was asked for the series of this book, once (see series/completion.ts). */
  seriesCheckedAt?: Timestamp;
  /** Prix d’achat of one copy, in euros (lot 5, insurance inventory). */
  price?: number;
  cover?: Cover;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * « Ma lecture » of a notice (lot 12): kept apart from the notice, which a place shared with the family
 * holds in common, whereas each person keeps their own reading. No record: to read, not rated, no review.
 */
export interface Reading {
  bookId: Id;
  status: ReadingStatus;
  /** 0 = not rated, otherwise 1 to 5. */
  rating: number;
  review: string;
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
  /** What OpenRouter read on the photograph (lot 6); not indexed, no new version of the schema. */
  coverReading?: CoverReading;
}

/** Title, authors and publisher read by OpenRouter on the photograph of an item (lot 6). */
export interface CoverReading {
  /** The photograph read: a new photograph is read again. */
  photoBlobId: Id;
  /** Empty when the photograph shows no book, or nothing legible. */
  title: string;
  authors: string[];
  publisher?: string;
  seriesName?: string;
  seriesIndex?: number;
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
  /** Searches that found nothing while a source did not answer; searched again from retryAt. */
  attempts?: number;
  retryAt?: Timestamp;
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
  /** Phone notification shown by the service worker once the return day has come. */
  notifiedAt?: Timestamp;
  /** Reminder of the library screen closed, or loans screen opened, once the return day has come. */
  seenAt?: Timestamp;
}

/** Where a wish comes from: a missing volume, the author page, a bookshop check, or typed by the user. */
export type WishSource = 'series' | 'author' | 'bookshop' | 'manual';

/** Souhait (lot 5). Removed by itself once the book enters the library (see wishes/wishes.ts). */
export interface Wish {
  id: Id;
  /** Empty when only the ISBN is known (bookshop check offline). */
  title: string;
  author?: string;
  isbn?: string;
  source: WishSource;
  /** A missing volume of a series of the library. */
  seriesName?: string;
  seriesIndex?: number;
  createdAt: Timestamp;
}

/** A volume of a series as the BnF lists it. */
export interface CatalogVolume {
  index: number;
  title: string;
  isbn13?: string;
}

/** The volumes of a series found at the BnF (see series/catalog.ts). */
export interface SeriesCatalog {
  /** Highest volume number listed; 0 when the BnF does not know the series. */
  total: number;
  volumes: CatalogVolume[];
  checkedAt: Timestamp;
  source: 'bnf';
}

/** What is known of a series (lot 5); its volumes are the notices bearing its name. */
export interface SeriesRecord {
  /** seriesKey() of the name. */
  id: string;
  /** « Nombre de tomes parus », declared by the user: it wins over the catalogue. */
  total?: number;
  /** Found at the BnF, searched again after a week. Not indexed: no new version of the schema. */
  catalog?: SeriesCatalog;
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
  /** Notification à l’échéance d’un prêt (Android: periodic background sync of the service worker). */
  loanNotifications: boolean;
  /** Ajouter chaque prêt à l’agenda: Google Agenda opens when a book is lent. */
  loanCalendar: boolean;
  /** Name shown at the top of the shared wish list (empty: none). */
  wishListName: string;
  /** Clé OpenRouter of the user (lot 6, empty: none), reading the covers photographed. Kept on the device only. */
  openRouterKey: string;
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
