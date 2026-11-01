import { useEffect, useState } from 'preact/hooks';
import { db, type LibraryDatabase } from '../db/db';
import type { Id } from '../db/schema';
import { getSettings } from '../db/settings';
import { attachAutoCover, completeFromMetadata, findMetadata } from '../scan/lookups';

// After an import: cover and missing fields of each notice searched in the background, two at a time
// so as not to overload the sources. Goes on whatever the screen shown, while the application is open.

export interface EnrichmentState {
  total: number;
  done: number;
  covers: number;
  /** Notices not searched for lack of network. */
  unavailable: number;
  /** « Couvertures automatiques » was on. */
  withCovers: boolean;
  running: boolean;
}

const CONCURRENCY = 2;

let state: EnrichmentState = { total: 0, done: 0, covers: 0, unavailable: 0, withCovers: true, running: false };
const queue: Id[] = [];
const listeners = new Set<(value: EnrichmentState) => void>();

function update(changes: Partial<EnrichmentState>): void {
  state = { ...state, ...changes };
  for (const listener of listeners) listener(state);
}

export type EnrichmentOutcome = 'cover' | 'noCover' | 'unavailable';

/** Fills the empty fields of an imported notice and, when allowed, gives it an automatic cover. */
export async function enrichBook(bookId: Id, withCovers: boolean, database: LibraryDatabase = db): Promise<EnrichmentOutcome> {
  const book = await database.books.get(bookId);
  if (!book?.isbn13) return 'noCover';
  const metadata = await findMetadata(book.isbn13, () => Promise.resolve(), database);
  if (!metadata) return 'unavailable';
  if (metadata.providers.length > 0) await completeFromMetadata(bookId, metadata, database);
  if (withCovers) await attachAutoCover(bookId, metadata, database);
  return (await database.books.get(bookId))?.cover ? 'cover' : 'noCover';
}

export function enrichBooks(bookIds: readonly Id[], database: LibraryDatabase = db): void {
  if (bookIds.length === 0) return;
  queue.push(...bookIds);
  if (state.running) {
    update({ total: state.total + bookIds.length });
    return;
  }
  update({ total: bookIds.length, done: 0, covers: 0, unavailable: 0, running: true });
  void (async () => {
    try {
      const { autoCovers } = await getSettings(database);
      update({ withCovers: autoCovers });
      const worker = async () => {
        for (let bookId = queue.shift(); bookId; bookId = queue.shift()) {
          const outcome = await enrichBook(bookId, autoCovers, database).catch((error: unknown) => {
            console.error(error);
            return 'noCover' as const;
          });
          update({
            done: state.done + 1,
            covers: state.covers + (outcome === 'cover' ? 1 : 0),
            unavailable: state.unavailable + (outcome === 'unavailable' ? 1 : 0),
          });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      update({ running: false });
    }
  })();
}

/** Progress of the search, refreshed as it goes. */
export function useEnrichment(): EnrichmentState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
