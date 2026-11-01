import { useEffect, useState } from 'preact/hooks';
import { db, type LibraryDatabase } from '../db/db';
import type { Id } from '../db/schema';
import { getSettings } from '../db/settings';
import { attachAutoCover, completeFromMetadata, findMetadata } from '../scan/lookups';

// Cover and missing fields of many notices searched in the background: after an import, or with
// « Rechercher les couvertures manquantes ». One notice at a time, at most one per second, so that
// Google Books does not refuse a burst of requests. Goes on whatever the screen shown, while the
// application is open.

export interface EnrichmentState {
  total: number;
  done: number;
  covers: number;
  /** Notices not searched in every source (no network, or a source that did not answer). */
  notSearched: number;
  /** « Couvertures automatiques » was on. */
  withCovers: boolean;
  running: boolean;
}

const MIN_INTERVAL_MS = 1000;

let state: EnrichmentState = { total: 0, done: 0, covers: 0, notSearched: 0, withCovers: true, running: false };
const queue: Id[] = [];
const listeners = new Set<(value: EnrichmentState) => void>();

function update(changes: Partial<EnrichmentState>): void {
  state = { ...state, ...changes };
  for (const listener of listeners) listener(state);
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/** cover: found; noCover: none in any source; notSearched: to try again later. */
export type EnrichmentOutcome = 'cover' | 'noCover' | 'notSearched';

/** Fills the empty fields of a notice and, when allowed, gives it an automatic cover. */
export async function enrichBook(bookId: Id, withCovers: boolean, database: LibraryDatabase = db): Promise<EnrichmentOutcome> {
  const book = await database.books.get(bookId);
  if (!book?.isbn13) return 'noCover';
  const metadata = await findMetadata(book.isbn13, () => Promise.resolve(), database);
  if (!metadata) return 'notSearched';
  if (metadata.providers.length > 0) await completeFromMetadata(bookId, metadata, database);
  if (withCovers) await attachAutoCover(bookId, metadata, database);
  if ((await database.books.get(bookId))?.cover) return 'cover';
  return metadata.incomplete ? 'notSearched' : 'noCover';
}

export function enrichBooks(bookIds: readonly Id[], database: LibraryDatabase = db): void {
  const added = bookIds.filter((id) => !queue.includes(id));
  if (added.length === 0) return;
  queue.push(...added);
  if (state.running) {
    update({ total: state.total + added.length });
    return;
  }
  update({ total: added.length, done: 0, covers: 0, notSearched: 0, running: true });
  void (async () => {
    try {
      const { autoCovers } = await getSettings(database);
      update({ withCovers: autoCovers });
      for (let bookId = queue.shift(); bookId; bookId = queue.shift()) {
        const started = Date.now();
        const outcome = await enrichBook(bookId, autoCovers, database).catch((error: unknown) => {
          console.error(error);
          return 'notSearched' as const;
        });
        update({
          done: state.done + 1,
          covers: state.covers + (outcome === 'cover' ? 1 : 0),
          notSearched: state.notSearched + (outcome === 'notSearched' ? 1 : 0),
        });
        await wait(MIN_INTERVAL_MS - (Date.now() - started));
      }
    } finally {
      update({ running: false });
    }
  })();
}

/** Notices with an ISBN and no cover: those « Rechercher les couvertures manquantes » searches. */
export async function booksWithoutCover(database: LibraryDatabase = db): Promise<Id[]> {
  return (await database.books.filter((book) => Boolean(book.isbn13) && !book.cover).toArray()).map((book) => book.id);
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
