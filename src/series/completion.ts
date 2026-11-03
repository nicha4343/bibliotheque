import { db, type LibraryDatabase } from '../db/db';
import type { Book } from '../db/schema';
import { getSettings } from '../db/settings';
import { isbn13To10, toIsbn13 } from '../isbn/isbn';
import { unimarcRecords, unimarcValue, volumeNumber } from '../metadata/sources';
import { seriesOf, type SeriesPart } from './series';

// Series of the books already in the library, asked once to the BnF: until 3 November 2026 its answers
// were not read (see unimarcRecords), so that the series it gives (zone 461) were lost. Only books in no
// series are completed: a series read from the title or given by the user is kept, as the volumes of a
// series must keep one name.

const BATCH = 10;
const PAUSE_MS = 500;
const START_DELAY_MS = 15_000;

export const seriesOfIsbnsUrl = (books: readonly Pick<Book, 'isbn13'>[]): string => {
  const codes = books.flatMap((book) => (book.isbn13 ? [book.isbn13, isbn13To10(book.isbn13)] : [])).filter(Boolean);
  const query = encodeURIComponent(`bib.isbn any "${codes.join(' ')}"`);
  return `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&recordSchema=unimarcxchange&maximumRecords=${BATCH * 3}&query=${query}`;
};

/** The series the BnF gives to each ISBN-13 of the answer. */
export function seriesByIsbn(xml: string): Map<string, SeriesPart> {
  const found = new Map<string, SeriesPart>();
  for (const fields of unimarcRecords(xml)) {
    const isbn13 = toIsbn13(unimarcValue(fields, '010', 'a') ?? '');
    const name = unimarcValue(fields, '461', 't');
    if (!isbn13 || !name || found.has(isbn13)) continue;
    const index = volumeNumber(unimarcValue(fields, '461', 'v'));
    found.set(isbn13, index === undefined ? { name } : { name, index });
  }
  return found;
}

// A series removed by the user (empty name) is not given back.
const waiting = (book: Book) =>
  Boolean(book.isbn13) && book.seriesCheckedAt === undefined && book.seriesName === undefined && !seriesOf(book);

/** Asks the BnF, ten books at a time; returns how many books joined a series. Stops when the BnF cannot be reached. */
export async function completeSeriesFromBnf(database: LibraryDatabase = db, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<number> {
  if (!(await getSettings(database)).sources.bnf) return 0;
  const books = (await database.books.toArray()).filter(waiting);
  let joined = 0;
  for (let start = 0; start < books.length; start += BATCH) {
    const batch = books.slice(start, start + BATCH);
    let xml: string;
    try {
      const response = await fetchImpl(seriesOfIsbnsUrl(batch), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return joined;
      xml = await response.text();
    } catch {
      return joined;
    }
    const series = seriesByIsbn(xml);
    const now = Date.now();
    joined += await database.transaction('rw', database.books, async () => {
      let count = 0;
      for (const book of batch) {
        const current = await database.books.get(book.id);
        if (!current || !waiting(current)) continue;
        const part = series.get(current.isbn13 ?? '');
        if (part) count += 1;
        await database.books.update(book.id, part ? { seriesName: part.name, seriesIndex: part.index, seriesCheckedAt: now } : { seriesCheckedAt: now });
      }
      return count;
    });
    if (start + BATCH < books.length) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return joined;
}

/** Once, some time after the start (a scan may be under way), and when the network comes back. */
export function startSeriesCompletion(): void {
  let running = false;
  const run = () => {
    if (running || !navigator.onLine) return;
    running = true;
    void completeSeriesFromBnf().finally(() => {
      running = false;
    });
  };
  window.setTimeout(run, START_DELAY_MS);
  window.addEventListener('online', run);
}
