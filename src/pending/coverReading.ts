import { liveQuery } from 'dexie';
import { db, type LibraryDatabase } from '../db/db';
import type { CoverReading, Id, PendingItem } from '../db/schema';
import { getSettings } from '../db/settings';
import { readCoverWithOpenRouter, type ReadOutcome } from '../metadata/openRouter';
import { parseHash, type RouteId } from '../router';

// The photographs of « À compléter » are read by OpenRouter in the background, one after the other,
// whatever the screen shown (lot 6): their title, author and publisher wait on the item (screens 3
// and 4). Never during a scan, which must not slow down; online only, with the user's key.

/** Screens reading barcodes. */
const SCANNING_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['scan', 'check', 'lend', 'giveBack', 'bookshop']);
/** The free models allow 20 requests a minute: one photograph at a time, unhurried. */
const SPACING_MS = 4000;
/** Over a limit, service or network unavailable, privacy settings to change: asked again after this delay. */
const BUSY_DELAY_MS = 60_000;
/** A photograph that could not be read twice is left until the next start. */
const MAX_FAILURES = 2;

const failures = new Map<Id, number>();
/** The key OpenRouter refused: nothing is sent until another one is entered. */
let refusedKey: string | undefined;
/** Why the reading waits, for the screens: the account forbids the free models, or the day's 50 are spent. */
let pause: { reason: 'policy' } | { reason: 'daily'; until: number } | undefined;
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

export const coverKeyRefused = (key: string): boolean => key.trim() !== '' && key.trim() === refusedKey;

export const coverReadingPause = (): typeof pause => (pause?.reason === 'daily' && pause.until <= Date.now() ? undefined : pause);

/** What was read on the item's current photograph, if it has been read. */
export const currentReading = (item: PendingItem): CoverReading | undefined =>
  item.photoBlobId && item.coverReading?.photoBlobId === item.photoBlobId ? item.coverReading : undefined;

/** Whether the photograph of the item waits to be read (never without a key OpenRouter accepts). */
export const awaitsReading = (item: PendingItem, openRouterKey: string): boolean =>
  openRouterKey.trim() !== '' &&
  !coverKeyRefused(openRouterKey) &&
  !!item.photoBlobId &&
  !currentReading(item) &&
  (failures.get(item.photoBlobId) ?? 0) < MAX_FAILURES;

type Read = (photo: Blob, key: string) => Promise<ReadOutcome>;

/** Reads the photograph of an item and keeps what was read, unless the photograph changed meanwhile. */
export async function readItemCover(
  itemId: Id,
  key: string,
  database: LibraryDatabase = db,
  read: Read = readCoverWithOpenRouter,
): Promise<ReadOutcome> {
  const item = await database.pendingItems.get(itemId);
  const photoBlobId = item?.photoBlobId;
  const photo = photoBlobId ? await database.blobs.get(photoBlobId) : undefined;
  if (!photoBlobId || !photo) return { status: 'failed' };
  const outcome = await read(photo.blob, key);
  if (outcome.status !== 'read') return outcome;
  await database.transaction('rw', database.pendingItems, async () => {
    const current = await database.pendingItems.get(itemId);
    if (current?.photoBlobId === photoBlobId) await database.pendingItems.update(itemId, { coverReading: { photoBlobId, ...outcome.cover } });
  });
  return outcome;
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
const wait = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function retryLater(delay: number, database: LibraryDatabase): void {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    wakeCoverReading(database);
  }, delay);
}

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
          const key = (await getSettings(database)).openRouterKey.trim();
          if (!key || coverKeyRefused(key)) break;
          const waiting = (await database.pendingItems.orderBy('createdAt').toArray()).filter((item) => awaitsReading(item, key));
          const item = waiting.find((candidate) => candidate.id === preferred) ?? waiting[0];
          if (!item?.photoBlobId) break;
          await wait(Math.max(0, lastRequestAt + SPACING_MS - Date.now()));
          if (scanning()) break;
          lastRequestAt = Date.now();
          const outcome = await readItemCover(item.id, key, database).catch((error: unknown): ReadOutcome => {
            console.error(error);
            return { status: 'failed' };
          });
          const before = pause;
          pause = outcome.status === 'policy' ? { reason: 'policy' } : outcome.status === 'busy' && outcome.retryAt ? { reason: 'daily', until: outcome.retryAt } : undefined;
          if (pause !== before) notify();
          if (outcome.status === 'refused') {
            refusedKey = key;
            notify();
            break;
          }
          // The privacy settings may be changed on OpenRouter's site, the key staying the same.
          if (outcome.status === 'policy' || outcome.status === 'busy') {
            retryLater(Math.max(BUSY_DELAY_MS, (outcome.status === 'busy' ? outcome.retryAt ?? 0 : 0) - Date.now()), database);
            break;
          }
          if (outcome.status === 'failed') {
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
