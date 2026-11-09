import { db, type LibraryDatabase } from '../db/db';
import { getSettings } from '../db/settings';
import { completeBook, mergeRecords } from './merge';
import { loadTriompheCatalog, TRIOMPHE_EDITION, triompheRecord } from './triomphe';

// The notices created before the list of the Éditions du Triomphe entered the application (9 November
// 2026) get what it knows: many of the user's had no publisher, some no author.

/**
 * Fills the empty fields of the notices already in the library whose ISBN is in the list (publisher,
 * authors…); never overwrites a field. Returns how many notices changed.
 */
export async function completeFromTriompheCatalog(database: LibraryDatabase = db): Promise<number> {
  const entries = await loadTriompheCatalog();
  const books = await database.books.filter((book) => Boolean(book.isbn13 && entries[book.isbn13])).toArray();
  let completed = 0;
  for (const book of books) {
    const entry = book.isbn13 ? entries[book.isbn13] : undefined;
    if (!book.isbn13 || !entry) continue;
    const metadata = mergeRecords(book.isbn13, [triompheRecord(entry)]);
    const changed = await database.transaction('rw', database.books, async () => {
      // The notice may have changed since it was read.
      const current = await database.books.get(book.id);
      const changes = current && completeBook(current, metadata);
      if (changes) await database.books.update(book.id, { ...changes, updatedAt: Date.now() });
      return Boolean(changes);
    });
    if (changed) completed += 1;
  }
  return completed;
}

const STORAGE_KEY = 'triompheCatalogue';
const START_DELAY_MS = 5000;

/**
 * Once for each edition of the list, a little after the start: the notices created before it get
 * what it knows. A field emptied by the user afterwards is not filled again.
 */
export function startTriompheCompletion(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) === TRIOMPHE_EDITION) return;
  } catch {
    // Storage unavailable: completed at each start, which changes nothing the second time.
  }
  setTimeout(() => {
    void (async () => {
      if (!(await getSettings()).sources.triomphe) return;
      await completeFromTriompheCatalog();
      try {
        localStorage.setItem(STORAGE_KEY, TRIOMPHE_EDITION);
      } catch {
        // Done again at the next start.
      }
    })().catch((error: unknown) => {
      console.error(error);
    });
  }, START_DELAY_MS);
}
