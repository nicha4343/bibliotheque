import type { Book, BookMetadata, MetadataProvider } from '../db/schema';
import type { SourceRecord } from './sources';

export const isUsable = (record: SourceRecord | undefined): record is SourceRecord => Boolean(record?.title);

const FIELDS = ['title', 'authors', 'publisher', 'year', 'language', 'seriesName', 'seriesIndex', 'isbn10'] as const;

// Open Library covers are larger than Google Books thumbnails: offered first.
const COVER_ORDER: MetadataProvider[] = ['openLibrary', 'googleBooks', 'bnf'];

/**
 * Records in order of arrival: the first usable record fills the fields, the following ones only
 * complete the empty fields (docs/SPEC.md, « Recherche des métadonnées »).
 */
export function mergeRecords(isbn13: string, records: readonly SourceRecord[]): BookMetadata {
  const merged: BookMetadata = { isbn13, providers: [] };
  const target = merged as unknown as Record<string, unknown>;
  for (const record of records.filter(isUsable)) {
    merged.providers.push(record.provider);
    for (const field of FIELDS) {
      if (target[field] === undefined && record[field] !== undefined) target[field] = record[field];
    }
  }
  const covers = records
    .filter((record): record is SourceRecord & { coverUrl: string } => Boolean(record.coverUrl))
    .sort((a, b) => COVER_ORDER.indexOf(a.provider) - COVER_ORDER.indexOf(b.provider))
    .map((record) => ({ provider: record.provider, url: record.coverUrl }));
  if (covers.length > 0) merged.coverUrls = covers;
  return merged;
}

/** Book fields taken from metadata, for a new notice. */
export function bookFieldsFromMetadata(metadata: BookMetadata): Pick<Book, 'title' | 'authors'> & Partial<Book> {
  const fields: Pick<Book, 'title' | 'authors'> & Partial<Book> = {
    isbn13: metadata.isbn13,
    title: metadata.title ?? '',
    authors: metadata.authors ?? [],
  };
  if (metadata.isbn10) fields.isbn10 = metadata.isbn10;
  if (metadata.publisher) fields.publisher = metadata.publisher;
  if (metadata.year) fields.year = metadata.year;
  if (metadata.language) fields.language = metadata.language;
  if (metadata.seriesName) fields.seriesName = metadata.seriesName;
  if (metadata.seriesIndex !== undefined) fields.seriesIndex = metadata.seriesIndex;
  return fields;
}

/**
 * Changes that fill the empty fields of an existing notice from later metadata; never overwrites
 * what is already there (in particular what the user typed). Undefined when nothing changes.
 */
export function completeBook(book: Book, metadata: BookMetadata): Partial<Book> | undefined {
  const changes: Partial<Book> = {};
  const fields = bookFieldsFromMetadata(metadata);
  if (!book.title && fields.title) changes.title = fields.title;
  if (book.authors.length === 0 && fields.authors.length > 0) changes.authors = fields.authors;
  for (const field of ['isbn10', 'publisher', 'year', 'language', 'seriesName', 'seriesIndex'] as const) {
    if (book[field] === undefined && fields[field] !== undefined) (changes as Record<string, unknown>)[field] = fields[field];
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}
