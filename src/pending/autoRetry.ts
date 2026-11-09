import { liveQuery } from 'dexie';
import { db, type LibraryDatabase } from '../db/db';
import type { Id, PendingItem } from '../db/schema';
import { isScanning } from '../router';
import { retryItem } from './pending';

// The items of « À compléter » put aside while a source did not answer (Google Books over its quota,
// a burst refused) are searched again by themselves at their time (lot 15), one after the other, the
// application open, online, never during a scan. An ISBN is declared unknown only when every source
// answered.

/** A timer cannot wait longer; the queue is looked at again then. A due item is searched at once (changes, network), not by the timer. */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
const MIN_WAIT_MS = 30_000;

const due = (item: PendingItem, now: number): boolean => item.retryAt !== undefined && item.retryAt <= now;

async function waitingItems(database: LibraryDatabase): Promise<PendingItem[]> {
  return (await database.pendingItems.where('kind').equals('unknownIsbn').toArray()).filter((item) => item.retryAt !== undefined);
}

let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Searches the items whose time has come, then waits for the next one. */
export async function retryDueItems(database: LibraryDatabase = db): Promise<void> {
  if (running) return;
  running = true;
  // Each item once a round: one whose time would not move is not searched over and over.
  const searched = new Set<Id>();
  try {
    for (;;) {
      if (isScanning() || !navigator.onLine) break;
      const now = Date.now();
      const item = (await waitingItems(database))
        .filter((candidate) => due(candidate, now) && !searched.has(candidate.id))
        .sort((a, b) => (a.retryAt ?? 0) - (b.retryAt ?? 0))[0];
      if (!item) break;
      searched.add(item.id);
      const outcome = await retryItem(item.id, database).catch((error: unknown) => {
        console.error(error);
        return { status: 'unavailable' as const };
      });
      // No network after all: the time of the item is kept, the search resumes when it comes back.
      if (outcome.status === 'unavailable') break;
    }
  } finally {
    running = false;
  }
  await scheduleNext(database);
}

async function scheduleNext(database: LibraryDatabase): Promise<void> {
  clearTimeout(timer);
  const next = Math.min(...(await waitingItems(database)).map((item) => item.retryAt ?? Infinity));
  if (!Number.isFinite(next)) return;
  timer = setTimeout(
    () => {
      void retryDueItems(database);
    },
    Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, next - Date.now())),
  );
}

export function startPendingRetries(): void {
  // An item put aside by a scan, or searched by hand: the next time changes.
  liveQuery(() => db.pendingItems.toArray()).subscribe({
    next: () => {
      void retryDueItems();
    },
    error: (error: unknown) => {
      console.error(error);
    },
  });
  // Leaving the scan, or the network coming back, resumes the searches.
  window.addEventListener('hashchange', () => {
    void retryDueItems();
  });
  window.addEventListener('online', () => {
    void retryDueItems();
  });
}
