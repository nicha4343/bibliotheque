import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { BookMetadata, Cover, Id, MetadataProvider, PendingItem, ScanEntry } from '../db/schema';
import { getSettings } from '../db/settings';
import { downloadCover } from '../metadata/covers';
import { bookFieldsFromMetadata, completeBook } from '../metadata/merge';
import { googleBooksPause, SearchUnavailable, searchMetadata } from '../metadata/search';
import { nextSearchAt } from '../pending/retrySchedule';
import { newBook, newCopy } from './session';

// Background search of the codes read (status searching), whatever the screen shown. The queue lives
// in the database: a code read offline or before closing the app is searched later.

const CONCURRENCY = 3;
const RETRY_DELAY_MS = 30_000;
/** Searches found nothing while a source was silent: after this many, the ISBN is declared unknown. */
const INCOMPLETE_ATTEMPTS = 3;

/** First usable metadata: creates the notice and its copy, unless the read was cancelled meanwhile. */
export async function resolveFound(entryId: Id, metadata: BookMetadata, database: LibraryDatabase = db): Promise<Id | undefined> {
  return database.transaction('rw', [database.scanEntries, database.books, database.copies], async () => {
    const entry = await database.scanEntries.get(entryId);
    if (entry?.status !== 'searching' || !entry.isbn13) return undefined;
    // The same ISBN may have been read twice before its first search ended.
    const existing = await database.books.where('isbn13').equals(entry.isbn13).first();
    if (existing) {
      await database.scanEntries.update(entryId, { status: 'asking', bookId: existing.id });
      return undefined;
    }
    const book = newBook(bookFieldsFromMetadata(metadata));
    await database.books.add(book);
    const copy = newCopy(book.id, entry.shelfId, entry.position);
    await database.copies.add(copy);
    await database.scanEntries.update(entryId, { status: 'added', bookId: book.id, copyId: copy.id, createdBook: true });
    return book.id;
  });
}

/**
 * ISBN unknown to the sources that answered: the read goes to « À compléter ». When some did not answer
 * (silent), it is searched again there by itself.
 */
export async function resolveUnknown(entryId: Id, database: LibraryDatabase = db, silent: readonly MetadataProvider[] = []): Promise<void> {
  await database.transaction('rw', [database.scanEntries, database.pendingItems], async () => {
    const entry = await database.scanEntries.get(entryId);
    if (entry?.status !== 'searching' || !entry.isbn13) return;
    const item: PendingItem = {
      id: newId(),
      kind: 'unknownIsbn',
      isbn: entry.isbn13,
      shelfId: entry.shelfId,
      sessionId: entry.sessionId,
      createdAt: Date.now(),
    };
    if (entry.position !== undefined) item.position = entry.position;
    if (silent.length > 0) {
      item.silentSources = [...silent];
      item.retryAt = nextSearchAt(0, silent);
    }
    await database.pendingItems.add(item);
    await database.scanEntries.update(entryId, { status: 'pending', pendingItemId: item.id });
  });
}

/** Completes the empty fields of a notice with later answers. */
export async function completeFromMetadata(bookId: Id, metadata: BookMetadata, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.books, async () => {
    const book = await database.books.get(bookId);
    const changes = book && completeBook(book, metadata);
    if (changes) await database.books.update(bookId, { ...changes, updatedAt: Date.now() });
  });
}

/** Automatic cover; a photograph of the user always wins and is never replaced. */
export async function attachAutoCover(bookId: Id, metadata: BookMetadata, database: LibraryDatabase = db): Promise<void> {
  const book = await database.books.get(bookId);
  if (!book || book.cover) return;
  const found = await downloadCover(metadata.isbn13, metadata.coverUrls ?? []);
  if (!found) return;
  await database.transaction('rw', database.books, database.blobs, async () => {
    const current = await database.books.get(bookId);
    if (!current || current.cover) return;
    const cover: Cover = { source: 'auto', url: found.url, provider: found.provider };
    if (found.blob) {
      cover.blobId = newId();
      await database.blobs.add({ id: cover.blobId, blob: found.blob, createdAt: Date.now() });
    }
    await database.books.update(bookId, { cover, updatedAt: Date.now() });
  });
}

/** Metadata from the local cache, or searched; undefined when the network is unavailable. */
export async function findMetadata(
  isbn13: string,
  onFirst: (metadata: BookMetadata) => Promise<unknown>,
  database: LibraryDatabase = db,
): Promise<BookMetadata | undefined> {
  const cached = await database.metadataCache.get(isbn13);
  if (cached) {
    await onFirst(cached.payload);
    return cached.payload;
  }
  const settings = await getSettings(database);
  let first: Promise<unknown> | undefined;
  try {
    const metadata = await searchMetadata(isbn13, {
      sources: settings.sources,
      googleBooksKey: settings.googleBooksKey,
      onProgress: (partial) => {
        first ??= onFirst(partial);
      },
    });
    await first;
    // A source that did not answer (Google Books over its quota, for instance) is asked again next time.
    if (metadata.providers.length > 0 && !metadata.incomplete) {
      await database.metadataCache.put({ isbn13, payload: metadata, fetchedAt: Date.now() });
    }
    return metadata;
  } catch (error) {
    await first;
    if (error instanceof SearchUnavailable) return undefined;
    throw error;
  }
}

/** Searches one code read; false when it must be searched again later. */
export async function processEntry(entry: ScanEntry, database: LibraryDatabase = db): Promise<boolean> {
  if (!entry.isbn13) return true;
  let bookId: Id | undefined;
  const metadata = await findMetadata(
    entry.isbn13,
    async (first) => {
      bookId = await resolveFound(entry.id, first, database);
    },
    database,
  );
  if (!metadata) return false;
  if (metadata.providers.length === 0) {
    // Unknown to the sources that answered, but one did not (Google Books refusing a burst, for
    // instance), and it may be the only one to know the book: searched again a little later, then
    // in « À compléter », by itself. Google Books over its daily quota answers no sooner than its next
    // day: put aside at once.
    const attempts = (entry.attempts ?? 0) + 1;
    const dayOver = Boolean(metadata.silent?.includes('googleBooks') && googleBooksPause());
    if (metadata.incomplete && attempts < INCOMPLETE_ATTEMPTS && !dayOver) {
      await database.scanEntries.update(entry.id, { attempts, retryAt: Date.now() + RETRY_DELAY_MS });
      return false;
    }
    await resolveUnknown(entry.id, database, metadata.silent);
    return true;
  }
  if (bookId) {
    await completeFromMetadata(bookId, metadata, database);
    if ((await getSettings(database)).autoCovers) await attachAutoCover(bookId, metadata, database);
  }
  return true;
}

let running = false;
let wakeAgain = false;
// Read through a function: the flag changes while the loop awaits.
const wokenMeanwhile = () => wakeAgain;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Searches every code waiting in the queue; call after each read and when the network comes back. */
export function wakeLookups(database: LibraryDatabase = db): void {
  if (running) {
    wakeAgain = true;
    return;
  }
  running = true;
  clearTimeout(retryTimer);
  void (async () => {
    let failures = 0;
    let deferred = 0;
    try {
      do {
        wakeAgain = false;
        if (!navigator.onLine) break;
        const searching = await database.scanEntries.where('status').equals('searching').sortBy('createdAt');
        // A code searched again after a silent source waits for its time, even when a new read wakes the queue.
        const now = Date.now();
        const waiting = searching.filter((entry) => (entry.retryAt ?? 0) <= now);
        deferred = searching.length - waiting.length;
        if (waiting.length === 0) break;
        failures = 0;
        const queue = [...waiting];
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            for (let entry = queue.shift(); entry; entry = queue.shift()) {
              const done = await processEntry(entry, database).catch((error: unknown) => {
                console.error(error);
                return false;
              });
              if (!done) failures += 1;
            }
          }),
        );
      } while (wokenMeanwhile() || failures === 0);
    } finally {
      running = false;
    }
    // Some sources did not answer: try again a little later.
    if (failures > 0 || deferred > 0) retryTimer = setTimeout(() => {
      wakeLookups(database);
    }, RETRY_DELAY_MS);
  })();
}

export function startLookups(): void {
  window.addEventListener('online', () => {
    wakeLookups();
  });
  wakeLookups();
}
