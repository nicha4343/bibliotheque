import { db, type LibraryDatabase } from '../db/db';
import type { Id, SeriesRecord } from '../db/schema';
import { getSettings } from '../db/settings';
import { searchSeriesCatalog } from './catalog';
import { catalogIsStale, groupSeries, type SeriesGroup } from './series';

/** Every series of the library, with what is known of them. */
export async function loadSeriesGroups(database: LibraryDatabase = db): Promise<SeriesGroup[]> {
  const [books, records] = await Promise.all([database.books.toArray(), database.series.toArray()]);
  return groupSeries(books, records);
}

/** Changes the record of a series, keeping its other fields; an empty record is removed. */
async function changeRecord(key: string, change: (record: SeriesRecord) => SeriesRecord, database: LibraryDatabase): Promise<void> {
  await database.transaction('rw', database.series, async () => {
    const next = change((await database.series.get(key)) ?? { id: key });
    if (next.total === undefined && next.catalog === undefined) await database.series.delete(key);
    else await database.series.put(next);
  });
}

/** « Nombre de tomes parus »; undefined: the number found at the BnF, or the highest volume owned, is kept. */
export async function setSeriesTotal(key: string, total: number | undefined, database: LibraryDatabase = db): Promise<void> {
  await changeRecord(
    key,
    ({ total: _previous, ...record }) => (total === undefined ? record : { ...record, total }),
    database,
  );
}

const searching = new Map<string, Promise<boolean>>();

/**
 * Searches the BnF for the volumes of a series, unless done in the last week (or forced). False when
 * the BnF could not be reached; the next opening of the series tries again.
 */
export function refreshCatalog(group: SeriesGroup, force = false, database: LibraryDatabase = db): Promise<boolean> {
  if (!force && !catalogIsStale(group)) return Promise.resolve(true);
  const running = searching.get(group.key);
  if (running) return running;
  const search = getSettings(database)
    // The BnF switched off among the sources is not asked either.
    .then(async (settings) => (settings.sources.bnf ? searchSeriesCatalog(group) : undefined))
    .then(async (catalog) => {
      if (!catalog) return true;
      await changeRecord(group.key, (record) => ({ ...record, catalog }), database);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      searching.delete(group.key);
    });
  searching.set(group.key, search);
  return search;
}

/** The series not searched in the last week, one after the other; stops when the BnF cannot be reached. */
export async function refreshCatalogs(groups: readonly SeriesGroup[], database: LibraryDatabase = db): Promise<void> {
  for (const group of groups) {
    if (!catalogIsStale(group)) continue;
    if (!(await refreshCatalog(group, false, database))) return;
  }
}

/** Groups a notice with a series (« Ajouter un ouvrage à cette série »). */
export async function setBookSeries(bookId: Id, name: string, index: number | undefined, database: LibraryDatabase = db): Promise<void> {
  await database.books.update(bookId, { seriesName: name, seriesIndex: index, updatedAt: Date.now() });
}
