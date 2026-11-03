import { liveQuery } from 'dexie';
import { db, type LibraryDatabase } from '../db/db';
import type { CoverReading, Id, PendingItem } from '../db/schema';
import { getSettings } from '../db/settings';
import { readCoverWithGemini, type GeminiOutcome } from '../metadata/gemini';
import { parseHash, type RouteId } from '../router';

// The photographs of « À compléter » are read by Gemini in the background, one after the other,
// whatever the screen shown (lot 6): their title, author and publisher wait on the item (screens 3
// and 4). Never during a scan, which must not slow down; online only, with the user's key.

/** Screens reading barcodes. */
const SCANNING_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['scan', 'check', 'lend', 'giveBack', 'bookshop']);
/** The free tier allows about ten requests a minute. */
const SPACING_MS = 6000;
/** Quota exhausted, service or network unavailable: asked again after this delay. */
const BUSY_DELAY_MS = 60_000;
/** A photograph Gemini failed to read twice is left until the next start. */
const MAX_FAILURES = 2;

const failures = new Map<Id, number>();
/** The key Gemini refused: nothing is sent until another one is entered. */
let refusedKey: string | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  listeners.forEach((listener) => {
    listener();
  });
};

/** Screens showing « Lecture de la couverture… »: a refusal or a failure changes nothing in the database. */
export function subscribeCoverReading(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const geminiKeyRefused = (key: string): boolean => key.trim() !== '' && key.trim() === refusedKey;

/** What was read on the item's current photograph, if it has been read. */
export const currentReading = (item: PendingItem): CoverReading | undefined =>
  item.photoBlobId && item.coverReading?.photoBlobId === item.photoBlobId ? item.coverReading : undefined;

/** Whether the photograph of the item waits for Gemini (never without a key Gemini accepts). */
export const awaitsReading = (item: PendingItem, geminiKey: string): boolean =>
  geminiKey.trim() !== '' &&
  !geminiKeyRefused(geminiKey) &&
  !!item.photoBlobId &&
  !currentReading(item) &&
  (failures.get(item.photoBlobId) ?? 0) < MAX_FAILURES;

type Read = (photo: Blob, key: string) => Promise<GeminiOutcome>;

/** Reads the photograph of an item and keeps what was read, unless the photograph changed meanwhile. */
export async function readItemCover(
  itemId: Id,
  key: string,
  database: LibraryDatabase = db,
  read: Read = readCoverWithGemini,
): Promise<GeminiOutcome['status']> {
  const item = await database.pendingItems.get(itemId);
  const photoBlobId = item?.photoBlobId;
  const photo = photoBlobId ? await database.blobs.get(photoBlobId) : undefined;
  if (!photoBlobId || !photo) return 'failed';
  const outcome = await read(photo.blob, key);
  if (outcome.status !== 'read') return outcome.status;
  await database.transaction('rw', database.pendingItems, async () => {
    const current = await database.pendingItems.get(itemId);
    if (current?.photoBlobId === photoBlobId) await database.pendingItems.update(itemId, { coverReading: { photoBlobId, ...outcome.cover } });
  });
  return 'read';
}

let running = false;
let wakeAgain = false;
// Read through a function: the flag changes while the loop awaits.
const wokenMeanwhile = () => wakeAgain;
let lastRequestAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** The item shown by the series entry (screen 4) is read before the others. */
let preferred: Id | undefined;

const scanning = (): boolean => SCANNING_ROUTES.has(parseHash(window.location.hash).id);
const pause = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function wakeCoverReading(database: LibraryDatabase = db): void {
  if (running) {
    wakeAgain = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        wakeAgain = false;
        for (;;) {
          if (scanning() || !navigator.onLine) break;
          const key = (await getSettings(database)).geminiKey.trim();
          if (!key || geminiKeyRefused(key)) break;
          const waiting = (await database.pendingItems.orderBy('createdAt').toArray()).filter((item) => awaitsReading(item, key));
          const item = waiting.find((candidate) => candidate.id === preferred) ?? waiting[0];
          if (!item?.photoBlobId) break;
          await pause(Math.max(0, lastRequestAt + SPACING_MS - Date.now()));
          if (scanning()) break;
          lastRequestAt = Date.now();
          const status = await readItemCover(item.id, key, database).catch((error: unknown) => {
            console.error(error);
            return 'failed' as const;
          });
          if (status === 'refused') {
            refusedKey = key;
            notify();
            break;
          }
          if (status === 'busy') {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              wakeCoverReading(database);
            }, BUSY_DELAY_MS);
            break;
          }
          if (status === 'failed') {
            failures.set(item.photoBlobId, (failures.get(item.photoBlobId) ?? 0) + 1);
            notify();
          }
        }
      } while (wokenMeanwhile());
    } finally {
      running = false;
    }
  })();
}

/** Screen 4 shows this item: its photograph is read first. */
export function preferCoverReading(itemId: Id | undefined): void {
  preferred = itemId;
}

export function startCoverReading(): void {
  // A new photograph, an item added by the scan, a key entered: the queue wakes up.
  liveQuery(async () => [await db.pendingItems.toArray(), await getSettings()]).subscribe({
    next: () => {
      wakeCoverReading();
    },
    error: (error: unknown) => {
      console.error(error);
    },
  });
  // Leaving the scan, or the network coming back, resumes the reading.
  window.addEventListener('hashchange', () => {
    wakeCoverReading();
  });
  window.addEventListener('online', () => {
    wakeCoverReading();
  });
}
