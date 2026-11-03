import type { Book, CatalogVolume, SeriesCatalog, SeriesRecord, Wish } from '../db/schema';
import { foldText, sortKey } from '../library/filter';

// Séries (lot 5, screen 9): the volumes of a series are the notices bearing its name, given by a
// source (BnF), an import (Libib groups), the user, or read from the title.

export interface SeriesPart {
  name: string;
  index?: number;
}

/** « Astérix », « asterix » and « Astérix. » are the same series. */
export const seriesKey = (name: string): string =>
  foldText(name)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// « Blake et Mortimer - Tome 1 - Le Secret de l’Espadon », « Les Misérables, tome 2 », « Tintin (vol. 5) »
const VOLUME_WORD = /^(.+?)\s*[-–—,:.(]\s*(?:tome|t\.|vol\.|volume|livre|n°|no\.|numéro)\s*(\d{1,4})(?!\d)/iu;
// « Naruto T03 », « One Piece T.100 »: a capital T, then the end of the title or a separator.
const VOLUME_LETTER = /^(.+?)\s+T\.?\s?(\d{1,4})(?=\s*(?:$|[-–—:,.(]))/u;

/** Series named by the title itself; undefined for most titles. */
export function seriesFromTitle(title: string): SeriesPart | undefined {
  const match = VOLUME_WORD.exec(title) ?? VOLUME_LETTER.exec(title);
  if (!match) return undefined;
  const name = (match[1] ?? '').replace(/[\s\-–—,:.(]+$/u, '').trim();
  if (!/\p{L}/u.test(name)) return undefined;
  return { name, index: Number.parseInt(match[2] ?? '', 10) };
}

/** Series of a notice: the one given, else the one its title names; none when the user removed it. */
export function seriesOf(book: Pick<Book, 'title' | 'seriesName' | 'seriesIndex'>): SeriesPart | undefined {
  if (book.seriesName === undefined) return seriesFromTitle(book.title);
  const name = book.seriesName.trim();
  if (!name) return undefined;
  if (book.seriesIndex !== undefined) return { name, index: book.seriesIndex };
  // The BnF and Libib groups may name the series without the volume, which the title gives.
  const fromTitle = seriesFromTitle(book.title);
  return fromTitle?.index !== undefined && seriesKey(fromTitle.name) === seriesKey(name) ? { name, index: fromTitle.index } : { name };
}

export interface SeriesVolume {
  book: Book;
  index?: number;
}

export interface SeriesGroup {
  key: string;
  /** The spelling most of its notices use. */
  name: string;
  /** By volume number, unnumbered ones last (by title). */
  volumes: SeriesVolume[];
  /** Most frequent authors and publisher of its notices. */
  authors: string[];
  publisher?: string;
  /** « Nombre de tomes parus » declared by the user. */
  declaredTotal?: number;
  /** The volumes found at the BnF; its total is used unless the user declared one. */
  catalog?: SeriesCatalog;
  /**
   * Volumes 1 to total are expected: the number declared, else found at the BnF, or more when a later
   * volume is owned. 0 when unknown.
   */
  total: number;
  /** Distinct volumes owned among 1 to total. */
  owned: number;
  missing: number[];
}

/** Volume numbers beyond this are not a sequence (a year, a catalogue number): nothing is called missing. */
const MAX_SEQUENCE = 500;

function mostFrequent(values: readonly string[]): string[] {
  const counts = new Map<string, { value: string; count: number; first: number }>();
  values.forEach((value, position) => {
    const key = foldText(value);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { value, count: 1, first: position });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.first - b.first).map((entry) => entry.value);
}

const byTitle = (a: Book, b: Book) => sortKey(a.title).localeCompare(sortKey(b.title), 'fr');

export function buildGroup(key: string, volumes: readonly SeriesVolume[], names: readonly string[], record?: SeriesRecord): SeriesGroup {
  const sorted = [...volumes].sort((a, b) => {
    if (a.index === undefined || b.index === undefined) return a.index === undefined ? (b.index === undefined ? byTitle(a.book, b.book) : 1) : -1;
    return a.index - b.index || byTitle(a.book, b.book);
  });
  const numbers = new Set(
    sorted.flatMap(({ index }) => (index !== undefined && Number.isInteger(index) && index >= 1 ? [index] : [])),
  );
  const highest = Math.max(0, ...numbers);
  const sequence = highest <= MAX_SEQUENCE;
  const found = record?.catalog && record.catalog.total <= MAX_SEQUENCE ? record.catalog.total : 0;
  const total = sequence ? Math.max(record?.total ?? found, highest) : 0;
  const missing: number[] = [];
  for (let index = 1; index <= total; index += 1) if (!numbers.has(index)) missing.push(index);
  const group: SeriesGroup = {
    key,
    name: mostFrequent(names)[0] ?? key,
    volumes: sorted,
    authors: mostFrequent(sorted.flatMap(({ book }) => book.authors)).slice(0, 2),
    total,
    owned: total - missing.length,
    missing,
  };
  const publisher = mostFrequent(sorted.flatMap(({ book }) => (book.publisher ? [book.publisher] : [])))[0];
  if (publisher) group.publisher = publisher;
  if (record?.total !== undefined) group.declaredTotal = record.total;
  if (record?.catalog) group.catalog = record.catalog;
  return group;
}

/** Title and ISBN of a volume, as the BnF lists it. */
export const catalogVolume = (group: Pick<SeriesGroup, 'catalog'>, index: number): CatalogVolume | undefined =>
  group.catalog?.volumes.find((volume) => volume.index === index);

/** The catalogue is searched again after a week: a new volume may have come out. */
export const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const catalogIsStale = (group: Pick<SeriesGroup, 'catalog'>, now = Date.now()): boolean =>
  !group.catalog || now - group.catalog.checkedAt > CATALOG_MAX_AGE_MS;

/** Every series of the library, by name. */
export function groupSeries(books: readonly Book[], records: readonly SeriesRecord[] = []): SeriesGroup[] {
  const parts = new Map<string, { volumes: SeriesVolume[]; names: string[] }>();
  for (const book of books) {
    const series = seriesOf(book);
    if (!series) continue;
    const key = seriesKey(series.name);
    if (!key) continue;
    let entry = parts.get(key);
    if (!entry) {
      entry = { volumes: [], names: [] };
      parts.set(key, entry);
    }
    entry.volumes.push(series.index === undefined ? { book } : { book, index: series.index });
    entry.names.push(series.name);
  }
  const recordOf = new Map(records.map((record) => [record.id, record]));
  return [...parts.entries()]
    .map(([key, { volumes, names }]) => buildGroup(key, volumes, names, recordOf.get(key)))
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'fr'));
}

/** A cell of the volume grid: an owned notice or a missing number. */
export type VolumeCell = { kind: 'owned'; index: number; book: Book } | { kind: 'missing'; index: number };

/** Numbered volumes and missing ones, in order; unnumbered volumes are listed apart. */
export function volumeCells(group: SeriesGroup): VolumeCell[] {
  const cells: VolumeCell[] = group.volumes.flatMap(({ book, index }) =>
    index === undefined ? [] : [{ kind: 'owned' as const, index, book }],
  );
  cells.push(...group.missing.map((index) => ({ kind: 'missing' as const, index })));
  return cells.sort((a, b) => a.index - b.index || (a.kind === 'owned' ? -1 : 1));
}

/** The wish for a missing volume, if the user has made one. */
export function volumeWish(wishes: readonly Wish[], key: string, index: number): Wish | undefined {
  return wishes.find((wish) => wish.seriesName !== undefined && wish.seriesIndex === index && seriesKey(wish.seriesName) === key);
}

// Authors: « J.K. Rowling » and « J. K. Rowling » are the same person.
export const authorKey = (name: string): string =>
  foldText(name)
    .replace(/[.\-‐]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Notices of an author, by title. */
export function booksOfAuthor(books: readonly Book[], name: string): Book[] {
  const key = authorKey(name);
  return books.filter((book) => book.authors.some((author) => authorKey(author) === key)).sort(byTitle);
}

/** Series in which the author has written at least one of the notices. */
export function seriesOfAuthor(groups: readonly SeriesGroup[], name: string): SeriesGroup[] {
  const key = authorKey(name);
  return groups.filter((group) => group.volumes.some(({ book }) => book.authors.some((author) => authorKey(author) === key)));
}
