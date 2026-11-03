import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Id, Wish } from '../db/schema';
import { workKey } from '../series/authorWorks';
import { authorKey, catalogVolume, seriesKey, seriesOf, type SeriesGroup } from '../series/series';
import { fr } from '../textes/fr';

// « Mes souhaits » (lot 5, screen 11): books the user would like, from a missing volume, the author
// page, a bookshop check or typed in.

export type WishFields = Omit<Wish, 'id' | 'createdAt'>;

const volumeId = (name: string, index: number) => `${seriesKey(name)}#${index}`;
const titleId = (title: string, author: string | undefined) => `${workKey(title)}|${author ? authorKey(author) : ''}`;

/** What identifies a wish or a book: its ISBN, its volume of a series, its title and author. */
function identities(item: { isbn?: string | undefined; title: string; author?: string | undefined; seriesName?: string | undefined; seriesIndex?: number | undefined }): string[] {
  const ids: string[] = [];
  if (item.isbn) ids.push(item.isbn);
  if (item.seriesName && item.seriesIndex !== undefined) ids.push(volumeId(item.seriesName, item.seriesIndex));
  if (item.title) ids.push(titleId(item.title, item.author));
  return ids;
}

function bookIdentities(book: Book): string[] {
  const ids: string[] = [];
  if (book.isbn13) ids.push(book.isbn13);
  const series = seriesOf(book);
  if (series?.index !== undefined) ids.push(volumeId(series.name, series.index));
  if (book.title) {
    ids.push(titleId(book.title, undefined));
    for (const author of book.authors) ids.push(titleId(book.title, author));
  }
  return ids;
}

/** Wishes the library now fulfils: the book was scanned, imported or completed meanwhile. */
export function acquiredWishes(wishes: readonly Wish[], books: readonly Book[]): Wish[] {
  const owned = new Set(books.flatMap(bookIdentities));
  return wishes.filter((wish) => identities(wish).some((id) => owned.has(id)));
}

/** The wish matching a book, if any (same ISBN, volume, or title and author). */
export function findWish(wishes: readonly Wish[], item: Parameters<typeof identities>[0]): Wish | undefined {
  const ids = new Set(identities(item));
  return wishes.find((wish) => identities(wish).some((id) => ids.has(id)));
}

/** « Pat’Apouf, tome 14 » under a missing volume whose title is known (the BnF lists it). */
export function wishSeriesLabel(wish: Pick<Wish, 'title' | 'seriesName' | 'seriesIndex'>): string | undefined {
  if (!wish.seriesName || wish.seriesIndex === undefined) return undefined;
  const label = fr.wishes.volumeTitle(wish.seriesName, wish.seriesIndex);
  return wish.title === label ? undefined : label;
}

/** Series volumes together and in order, then the other wishes by title. */
export function sortWishes(wishes: readonly Wish[]): Wish[] {
  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  const label = (wish: Wish) => (wish.seriesName ? `${wish.seriesName} ${String(wish.seriesIndex ?? 0).padStart(4, '0')}` : wish.title);
  return [...wishes].sort((a, b) => collator.compare(label(a), label(b)) || a.createdAt - b.createdAt);
}

export function newWish(fields: WishFields, now = Date.now()): Wish {
  const wish: Wish = { id: newId(), title: fields.title.trim(), source: fields.source, createdAt: now };
  const author = fields.author?.trim();
  if (author) wish.author = author;
  if (fields.isbn) wish.isbn = fields.isbn;
  if (fields.seriesName && fields.seriesIndex !== undefined) {
    wish.seriesName = fields.seriesName;
    wish.seriesIndex = fields.seriesIndex;
  }
  return wish;
}

/** Adds a wish, unless the same book is already wished: the existing one is returned (created false). */
export async function addWish(fields: WishFields, database: LibraryDatabase = db): Promise<{ wish: Wish; created: boolean }> {
  return database.transaction('rw', database.wishes, async () => {
    const existing = findWish(await database.wishes.toArray(), fields);
    if (existing) return { wish: existing, created: false };
    const wish = newWish(fields);
    await database.wishes.add(wish);
    return { wish, created: true };
  });
}

export async function updateWish(id: Id, fields: Pick<Wish, 'title'> & Partial<Pick<Wish, 'author' | 'isbn'>>, database: LibraryDatabase = db): Promise<void> {
  await database.wishes.update(id, { title: fields.title.trim(), author: fields.author?.trim() || undefined, isbn: fields.isbn || undefined });
}

export async function removeWish(id: Id, database: LibraryDatabase = db): Promise<void> {
  await database.wishes.delete(id);
}

/** Removes the wishes fulfilled by the library; returns how many. */
export async function removeAcquiredWishes(database: LibraryDatabase = db): Promise<number> {
  return database.transaction('rw', database.wishes, database.books, async () => {
    const acquired = acquiredWishes(await database.wishes.toArray(), await database.books.toArray());
    await database.wishes.bulkDelete(acquired.map((wish) => wish.id));
    return acquired.length;
  });
}

/** A missing volume: its title and ISBN when the BnF lists it, else « Astérix, tome 4 ». */
const volumeFields = (group: SeriesGroup, index: number): WishFields => {
  const listed = catalogVolume(group, index);
  const fields: WishFields = {
    title: listed?.title ?? fr.wishes.volumeTitle(group.name, index),
    source: 'series',
    seriesName: group.name,
    seriesIndex: index,
  };
  const [author] = group.authors;
  if (author) fields.author = author;
  if (listed?.isbn13) fields.isbn = listed.isbn13;
  return fields;
};

/** Touching a missing volume adds it to the wishes, or takes it out. True when it is now wished. */
export async function toggleVolumeWish(group: SeriesGroup, index: number, database: LibraryDatabase = db): Promise<boolean> {
  return database.transaction('rw', database.wishes, async () => {
    const wishes = await database.wishes.toArray();
    const existing = wishes.filter((wish) => wish.seriesName && wish.seriesIndex === index && seriesKey(wish.seriesName) === group.key);
    if (existing.length > 0) {
      await database.wishes.bulkDelete(existing.map((wish) => wish.id));
      return false;
    }
    await database.wishes.add(newWish(volumeFields(group, index)));
    return true;
  });
}

/** « Ajouter les tomes manquants à mes souhaits »: those not wished yet. Returns how many were added. */
export async function wishMissingVolumes(group: SeriesGroup, database: LibraryDatabase = db): Promise<number> {
  return database.transaction('rw', database.wishes, async () => {
    const wishes = await database.wishes.toArray();
    const added = group.missing
      .filter((index) => !findWish(wishes, volumeFields(group, index)))
      .map((index) => newWish(volumeFields(group, index)));
    await database.wishes.bulkAdd(added);
    return added.length;
  });
}
