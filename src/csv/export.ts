import { NO_READING, readingsByBook, type ReadingFields } from '../books/readings';
import { db, type LibraryDatabase } from '../db/db';
import type { Book, Copy, Id, Reading, ReadingStatus, Timestamp } from '../db/schema';
import { sortKey } from '../library/filter';
import { joinAuthors } from '../pending/pending';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { fr } from '../textes/fr';
import { toCsv } from './csv';

// « Exporter (CSV, Excel) »: one row per copy, so that each row has its place, room and shelf. Photographs
// cannot be part of a CSV file.

type Column = keyof typeof fr.csv.columns;

const COLUMNS: readonly Column[] = [
  'title',
  'authors',
  'publisher',
  'year',
  'isbn13',
  'isbn10',
  'language',
  'series',
  'volume',
  'site',
  'room',
  'shelf',
  'status',
  'rating',
  'review',
  'tags',
  'addedAt',
  'note',
  'price',
];

const STATUS_TEXTS: Record<ReadingStatus, string> = { read: fr.csv.statusRead, toread: fr.csv.statusToRead };

/** 12.5 → « 12,50 »: a decimal comma, as French spreadsheets expect. */
export const formatCsvPrice = (price: number): string => price.toFixed(2).replace('.', ',');

/** 2026-11-01 (local date): sorted correctly and recognised by spreadsheets. */
export function isoDate(timestamp: Timestamp): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rowOf(book: Book, reading: ReadingFields, copy: Copy | undefined, places: PlaceIndex): string[] {
  const place = copy ? places.byShelfId.get(copy.shelfId) : undefined;
  const values: Record<Column, string> = {
    title: book.title,
    authors: joinAuthors(book.authors),
    publisher: book.publisher ?? '',
    year: book.year === undefined ? '' : String(book.year),
    isbn13: book.isbn13 ?? '',
    isbn10: book.isbn10 ?? '',
    language: book.language ?? '',
    series: book.seriesName ?? '',
    volume: book.seriesIndex === undefined ? '' : String(book.seriesIndex),
    site: place?.site.name ?? '',
    room: place?.room.name ?? '',
    shelf: place?.shelf.name ?? '',
    status: STATUS_TEXTS[reading.status],
    rating: reading.rating > 0 ? String(reading.rating) : '',
    review: reading.review,
    tags: book.tags.join(', '),
    addedAt: isoDate(copy?.addedAt ?? book.createdAt),
    note: copy?.note ?? '',
    price: book.price === undefined ? '' : formatCsvPrice(book.price),
  };
  return COLUMNS.map((column) => values[column]);
}

/** Header, then the copies by place, room, shelf and title, as the library lists them. */
export function exportRows(
  books: readonly Book[],
  copies: readonly Copy[],
  places: PlaceIndex,
  readings: readonly Reading[] = [],
): string[][] {
  const readingOf = readingsByBook(readings);
  const shelfRank = new Map<Id, number>();
  for (const room of places.rooms) {
    for (const shelf of places.shelvesByRoom.get(room.id) ?? []) shelfRank.set(shelf.id, shelfRank.size);
  }
  const copiesByBook = new Map<Id, Copy[]>();
  for (const copy of copies) copiesByBook.set(copy.bookId, [...(copiesByBook.get(copy.bookId) ?? []), copy]);

  const lines = books.flatMap((book) => {
    const bookCopies = copiesByBook.get(book.id) ?? [];
    // A notice always has a copy; a row is kept for it anyway.
    const list: (Copy | undefined)[] = bookCopies.length > 0 ? bookCopies : [undefined];
    return list.map((copy) => ({
      rank: copy ? (shelfRank.get(copy.shelfId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER,
      key: sortKey(book.title),
      addedAt: copy?.addedAt ?? book.createdAt,
      cells: rowOf(book, readingOf.get(book.id) ?? NO_READING, copy, places),
    }));
  });
  lines.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key, 'fr') || a.addedAt - b.addedAt);
  return [COLUMNS.map((column) => fr.csv.columns[column]), ...lines.map((line) => line.cells)];
}

export interface ExportResult {
  text: string;
  books: number;
  copies: number;
}

export async function exportLibrary(database: LibraryDatabase = db): Promise<ExportResult> {
  const [books, copies, places, readings] = await Promise.all([
    database.books.toArray(),
    database.copies.toArray(),
    loadPlaces(database),
    database.readings.toArray(),
  ]);
  return { text: toCsv(exportRows(books, copies, places, readings)), books: books.length, copies: copies.length };
}

/** Saves the text as a file through the browser (« Téléchargements » on Android). */
export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  downloadBlob(fileName, new Blob([text], { type }));
}

/** Saves a file through the browser (« Téléchargements » on Android). */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later: some browsers read the file after click() returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
