import { db, type LibraryDatabase } from '../db/db';
import type { Id } from '../db/schema';
import { groupSeries, type SeriesGroup } from './series';

/** Every series of the library, with what the user declared of them. */
export async function loadSeriesGroups(database: LibraryDatabase = db): Promise<SeriesGroup[]> {
  const [books, records] = await Promise.all([database.books.toArray(), database.series.toArray()]);
  return groupSeries(books, records);
}

/** « Nombre de tomes parus »; undefined: the highest volume owned is kept. */
export async function setSeriesTotal(key: string, total: number | undefined, database: LibraryDatabase = db): Promise<void> {
  if (total === undefined) await database.series.delete(key);
  else await database.series.put({ id: key, total });
}

/** Groups a notice with a series (« Ajouter un ouvrage à cette série »). */
export async function setBookSeries(bookId: Id, name: string, index: number | undefined, database: LibraryDatabase = db): Promise<void> {
  await database.books.update(bookId, { seriesName: name, seriesIndex: index, updatedAt: Date.now() });
}
