import { liveQuery } from 'dexie';
import { db, type LibraryDatabase } from '../db/db';
import type { CoverReading, Id, PendingItem } from '../db/schema';
import { parseHash, type RouteId } from '../router';
import { mergeSuggestions, readCover, type KnownNames } from './cover';
import { PAGE_SIZE, recognizeLines, textRecognitionSupported, type RecognizedImage, type TextLayout } from './engine';
import { passageText } from './passage';

// The photographs of « À compléter » are read in the background, one after the other, whatever the
// screen shown: their title, author and publisher wait on the item (screens 3 and 4). Never during
// a scan, which must not slow down.

/** Screens reading barcodes. */
const SCANNING_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['scan', 'check', 'lend', 'giveBack', 'bookshop']);
/** A photograph Tesseract failed to read twice is left for this session. */
const MAX_FAILURES = 2;

const supported = textRecognitionSupported();
const failures = new Map<Id, number>();
/** Screens showing « Lecture de la couverture… »: a failure changes nothing in the database. */
const listeners = new Set<() => void>();

export function subscribeReadingFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The reading of the item's current photograph, if it has been read. */
export const currentReading = (item: PendingItem): CoverReading | undefined =>
  item.photoBlobId && item.reading?.photoBlobId === item.photoBlobId ? item.reading : undefined;

/** Whether the photograph of the item waits to be read (always false where Tesseract cannot run). */
export const awaitsReading = (item: PendingItem): boolean =>
  supported && !!item.photoBlobId && !currentReading(item) && (failures.get(item.photoBlobId) ?? 0) < MAX_FAILURES;

/** Authors and publishers of the library: a name read on a cover is recognized by them. */
async function knownNames(database: LibraryDatabase): Promise<KnownNames> {
  const books = await database.books.toArray();
  return {
    authors: [...new Set(books.flatMap((book) => book.authors))],
    publishers: [...new Set(books.flatMap((book) => (book.publisher ? [book.publisher] : [])))],
  };
}

type Recognize = (photo: Blob, layout: TextLayout, size?: number) => Promise<RecognizedImage>;

/** Reads the photograph of an item and keeps what was read, unless the photograph changed meanwhile. */
export async function readItem(
  itemId: Id,
  database: LibraryDatabase = db,
  recognize: Recognize = recognizeLines,
  known?: KnownNames,
): Promise<void> {
  const item = await database.pendingItems.get(itemId);
  const photoBlobId = item?.photoBlobId;
  if (!photoBlobId) return;
  const photo = await database.blobs.get(photoBlobId);
  if (!photo) return;
  const names = known ?? (await knownNames(database));
  // Scattered words first; without a title, the page layout reads what the first missed (« EN FUSÉE »).
  const first = readCover(await recognize(photo.blob, 'sparse'), names);
  const suggestions = first.titles.length > 0 ? first : mergeSuggestions(first, readCover(await recognize(photo.blob, 'auto'), names));
  await database.transaction('rw', database.pendingItems, async () => {
    const current = await database.pendingItems.get(itemId);
    if (current?.photoBlobId === photoBlobId) await database.pendingItems.update(itemId, { reading: { photoBlobId, ...suggestions } });
  });
}

let running = false;
let wakeAgain = false;
// Read through a function: the flag changes while the loop awaits.
const wokenMeanwhile = () => wakeAgain;
/** The item shown by the series entry (screen 4) is read before the others. */
let preferred: Id | undefined;

const scanning = (): boolean => SCANNING_ROUTES.has(parseHash(window.location.hash).id);

function wakeReading(database: LibraryDatabase = db): void {
  if (!supported) return;
  if (running) {
    wakeAgain = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        wakeAgain = false;
        let known: KnownNames | undefined;
        for (;;) {
          if (scanning()) break;
          const waiting = (await database.pendingItems.orderBy('createdAt').toArray()).filter(awaitsReading);
          const item = waiting.find((candidate) => candidate.id === preferred) ?? waiting[0];
          if (!item?.photoBlobId) break;
          known ??= await knownNames(database);
          try {
            await readItem(item.id, database, recognizeLines, known);
          } catch (error) {
            // The engine may be unreachable (first use offline): tried again at the next wake.
            console.error(error);
            failures.set(item.photoBlobId, (failures.get(item.photoBlobId) ?? 0) + 1);
            listeners.forEach((listener) => {
              listener();
            });
            break;
          }
        }
      } while (wokenMeanwhile());
    } finally {
      running = false;
    }
  })();
}

/** Screen 4 shows this item: its photograph is read first. */
export function preferReading(itemId: Id | undefined): void {
  preferred = itemId;
}

export function startCoverReading(): void {
  if (!supported) return;
  // A new photograph, an item added by the scan: the queue wakes up.
  liveQuery(() => db.pendingItems.toArray()).subscribe({
    next: () => {
      wakeReading();
    },
    error: (error: unknown) => {
      console.error(error);
    },
  });
  // Leaving the scan resumes the reading.
  window.addEventListener('hashchange', () => {
    wakeReading();
  });
  window.addEventListener('online', () => {
    wakeReading();
  });
}

/** Text of a photographed passage (« Citations », screen 6), empty when nothing could be read. */
export async function readPassage(photoBlobId: Id, database: LibraryDatabase = db, recognize: Recognize = recognizeLines): Promise<string> {
  const photo = await database.blobs.get(photoBlobId);
  return photo ? passageText(await recognize(photo.blob, 'auto', PAGE_SIZE)) : '';
}
