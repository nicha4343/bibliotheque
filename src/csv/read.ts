import type { Book, Timestamp } from '../db/schema';
import { cleanIsbn, isValidIsbn10, toIsbn13 } from '../isbn/isbn';
import { foldText } from '../library/filter';
import { parseAuthors } from '../pending/pending';
import { fr } from '../textes/fr';

// Rows of an imported CSV file turned into notices and copies: files exported by this application
// (French column names, one row per copy) and Libib exports (one row per item, with a copy count).

export type FileFormat = 'app' | 'libib';

export interface ImportedCopy {
  /** Room and shelf named in the file; a copy without them goes to the shelf chosen by the user. */
  room?: string;
  shelf?: string;
  addedAt?: Timestamp;
  note?: string;
}

export type ImportedFields = Pick<Book, 'title' | 'authors' | 'status' | 'rating' | 'review' | 'tags'> &
  Partial<Pick<Book, 'isbn13' | 'isbn10' | 'publisher' | 'year' | 'language' | 'seriesName' | 'seriesIndex'>>;

export interface ImportedBook {
  fields: ImportedFields;
  copies: ImportedCopy[];
}

export type ReadResult =
  | { ok: true; format: FileFormat; books: ImportedBook[]; ignoredRows: number }
  | { ok: false; error: 'empty' | 'unknownFormat' };

/** « Ajouté le », « added_date », « ISBN-13 » → « ajoutele », « addeddate », « isbn13 ». */
export function headerKey(header: string): string {
  return foldText(header).replace(/[^a-z0-9]/g, '');
}

/** Same notice: same ISBN, or, without ISBN, same title and first author (case and accents ignored). */
export function titleKey(fields: Pick<Book, 'title' | 'authors'>): string {
  return `${foldText(fields.title)}|${foldText(fields.authors[0] ?? '')}`;
}

const bookKey = (fields: ImportedFields): string => fields.isbn13 ?? titleKey(fields);

/** A spreadsheet may show an ISBN as ="978…" or '978… to keep it as text. */
function cleanCell(value: string): string {
  return value
    .trim()
    .replace(/^="(.*)"$/, '$1')
    .replace(/^'/, '');
}

function readIsbns(isbn13Cell: string, isbn10Cell: string): Pick<ImportedFields, 'isbn13' | 'isbn10'> {
  const raw10 = cleanIsbn(cleanCell(isbn10Cell));
  // A leading zero may have been dropped by a spreadsheet that took the ISBN-10 for a number.
  const padded = /^\d{7,9}X?$/.test(raw10) && raw10.length >= 8 ? raw10.padStart(10, '0') : raw10;
  const isbn10 = /[1-9X]/.test(padded) && isValidIsbn10(padded) ? padded : undefined;
  const isbn13 = toIsbn13(cleanCell(isbn13Cell)) ?? (isbn10 ? toIsbn13(isbn10) : undefined);
  return { ...(isbn13 ? { isbn13 } : {}), ...(isbn10 ? { isbn10 } : {}) };
}

function readYear(value: string): number | undefined {
  const match = /(?<!\d)(\d{4})(?!\d)/.exec(value);
  const year = match ? Number(match[1]) : NaN;
  return year >= 1400 && year <= 2200 ? year : undefined;
}

function readRating(value: string): number {
  const rating = Number(value.trim().replace(',', '.'));
  return Number.isFinite(rating) ? Math.min(5, Math.max(0, Math.round(rating))) : 0;
}

function readTags(value: string): string[] {
  return [...new Set(parseAuthors(value))];
}

/**
 * 2026-11-01, or with slashes: day first in a French file (Excel turns ISO dates into 01/11/2026),
 * month first in a Libib file (American), unless the numbers allow only one reading.
 */
export function readDate(value: string, order: 'dayFirst' | 'monthFirst'): Timestamp | undefined {
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  const other = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (other) {
    let [first, second] = [Number(other[1]), Number(other[2])];
    if (order === 'monthFirst' ? first <= 12 && second <= 31 : second > 12) [first, second] = [second, first];
    [day, month, year] = [first, second, Number(other[3])];
  } else {
    return undefined;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : undefined;
}

type Cells = (keys: readonly string[]) => string;

/** Reads a row by column names; the first column found among keys wins. */
function cellReader(headers: readonly string[], row: readonly string[]): Cells {
  return (keys) => {
    for (const key of keys) {
      const index = headers.indexOf(key);
      if (index >= 0) return (row[index] ?? '').trim();
    }
    return '';
  };
}

const APP = Object.fromEntries(
  Object.entries(fr.csv.columns).map(([key, header]) => [key, [headerKey(header)]]),
) as Record<keyof typeof fr.csv.columns, string[]>;

function readAppRow(cell: Cells): ImportedBook {
  const status = headerKey(cell(APP.status));
  const seriesIndex = Number(cell(APP.volume).replace(',', '.'));
  const fields: ImportedFields = {
    ...readIsbns(cell(APP.isbn13), cell(APP.isbn10)),
    title: cell(APP.title),
    authors: parseAuthors(cell(APP.authors)),
    status: status === headerKey(fr.csv.statusRead) || status === 'read' ? 'read' : 'toread',
    rating: readRating(cell(APP.rating)),
    review: cell(APP.review),
    tags: readTags(cell(APP.tags)),
  };
  const publisher = cell(APP.publisher);
  const year = readYear(cell(APP.year));
  const language = cell(APP.language);
  const seriesName = cell(APP.series);
  if (publisher) fields.publisher = publisher;
  if (year) fields.year = year;
  if (language) fields.language = language;
  if (seriesName) fields.seriesName = seriesName;
  if (cell(APP.volume) && Number.isFinite(seriesIndex)) fields.seriesIndex = seriesIndex;

  const copy: ImportedCopy = {};
  const room = cell(APP.room);
  const shelf = cell(APP.shelf);
  const addedAt = readDate(cell(APP.addedAt), 'dayFirst');
  const note = cell(APP.note);
  if (room) copy.room = room;
  if (room && shelf) copy.shelf = shelf;
  if (addedAt !== undefined) copy.addedAt = addedAt;
  if (note) copy.note = note;
  return { fields, copies: [copy] };
}

// Libib column names: those of the current export first, then those of older exports.
const LIBIB = {
  itemType: ['itemtype', 'type'],
  title: ['title'],
  creators: ['creators', 'authors', 'author'],
  firstName: ['firstname'],
  lastName: ['lastname'],
  isbn13: ['eanisbn13', 'isbn13', 'ean', 'isbn'],
  isbn10: ['upcisbn10', 'isbn10'],
  publisher: ['publisher'],
  published: ['publishdate', 'published', 'year'],
  status: ['status'],
  rating: ['rating'],
  review: ['review'],
  tags: ['tags'],
  notes: ['notes'],
  // Libib groups gather the volumes of a series.
  group: ['group', 'groups'],
  copies: ['copies'],
  added: ['added', 'addeddate', 'dateadded'],
} as const;

/** « Albert Camus » or, when Libib splits the first creator into last and first names, « Camus, Albert ». */
function libibAuthors(creators: string, firstName: string, lastName: string): string[] {
  const names = parseAuthors(creators);
  if (firstName && lastName && names[0] === lastName && names[1] === firstName) {
    return [`${firstName} ${lastName}`, ...names.slice(2)];
  }
  if (names.length === 0 && (firstName || lastName)) return [[firstName, lastName].filter(Boolean).join(' ')];
  return names;
}

/** Undefined for an item that is not a book (film, music, game). */
function readLibibRow(cell: Cells): ImportedBook | undefined {
  const itemType = headerKey(cell(LIBIB.itemType));
  if (itemType && !itemType.startsWith('book')) return undefined;
  const fields: ImportedFields = {
    ...readIsbns(cell(LIBIB.isbn13), cell(LIBIB.isbn10)),
    title: cell(LIBIB.title),
    authors: libibAuthors(cell(LIBIB.creators), cell(LIBIB.firstName), cell(LIBIB.lastName)),
    status: headerKey(cell(LIBIB.status)) === 'completed' ? 'read' : 'toread',
    rating: readRating(cell(LIBIB.rating)),
    review: cell(LIBIB.review),
    tags: readTags(cell(LIBIB.tags)),
  };
  const publisher = cell(LIBIB.publisher);
  const year = readYear(cell(LIBIB.published));
  const group = cell(LIBIB.group);
  if (publisher) fields.publisher = publisher;
  if (year) fields.year = year;
  if (group) fields.seriesName = group;

  const copies = Number.parseInt(cell(LIBIB.copies), 10);
  const addedAt = readDate(cell(LIBIB.added), 'monthFirst');
  const note = cell(LIBIB.notes);
  return {
    fields,
    copies: Array.from({ length: Number.isFinite(copies) ? Math.min(500, Math.max(1, copies)) : 1 }, (_, index) => {
      const copy: ImportedCopy = {};
      if (addedAt !== undefined) copy.addedAt = addedAt;
      // Libib notes concern the item: kept once, on the first copy.
      if (note && index === 0) copy.note = note;
      return copy;
    }),
  };
}

/** File format from its header row; undefined when neither this application nor Libib wrote it. */
export function detectFormat(headers: readonly string[]): FileFormat | undefined {
  if (headers.includes(headerKey(fr.csv.columns.title))) return 'app';
  if (headers.includes('title')) return 'libib';
  return undefined;
}

/** Notices of the file; rows of the same notice (same ISBN, or same title and author) become its copies. */
export function readLibraryFile(rows: readonly (readonly string[])[]): ReadResult {
  const [header, ...body] = rows;
  if (!header || body.length === 0) return { ok: false, error: 'empty' };
  const headers = header.map(headerKey);
  const format = detectFormat(headers);
  if (!format) return { ok: false, error: 'unknownFormat' };

  const books = new Map<string, ImportedBook>();
  let ignoredRows = 0;
  for (const row of body) {
    const cell = cellReader(headers, row);
    const book = format === 'app' ? readAppRow(cell) : readLibibRow(cell);
    // Without a title, the ISBN lets the sources fill it in after the import.
    if (!book || (!book.fields.title && !book.fields.isbn13)) {
      ignoredRows += 1;
      continue;
    }
    const key = bookKey(book.fields);
    const same = books.get(key);
    if (same) same.copies.push(...book.copies);
    else books.set(key, book);
  }
  if (books.size === 0 && ignoredRows === 0) return { ok: false, error: 'empty' };
  return { ok: true, format, books: [...books.values()], ignoredRows };
}
