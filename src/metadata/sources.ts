import { isbn13To10 } from '../isbn/isbn';
import type { MetadataProvider } from '../db/schema';

/** What one source knows about an ISBN. A record without a title is not usable. */
export interface SourceRecord {
  provider: MetadataProvider;
  title?: string;
  authors?: string[];
  publisher?: string;
  year?: number;
  language?: string;
  seriesName?: string;
  seriesIndex?: number;
  isbn10?: string;
  coverUrl?: string;
}

/**
 * The request to send to a source for an ISBN-13. Without a key, Google Books shares one daily
 * quota between every site calling it and often refuses: the user may enter a key of their own.
 */
export function sourceUrl(provider: MetadataProvider, isbn13: string, googleBooksKey = ''): string {
  switch (provider) {
    case 'googleBooks': {
      const key = googleBooksKey.trim() ? `&key=${encodeURIComponent(googleBooksKey.trim())}` : '';
      return `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&maxResults=1${key}`;
    }
    case 'openLibrary':
      return `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`;
    case 'bnf': {
      // Books catalogued before 2007 only carry their ISBN-10.
      const codes = [isbn13, isbn13To10(isbn13)].filter(Boolean).join(' ');
      const query = encodeURIComponent(`bib.isbn any "${codes}"`);
      return `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=${query}&recordSchema=unimarcxchange&maximumRecords=1`;
    }
  }
}

/** Open Library cover by ISBN: answers 404 when there is none. */
export function openLibraryCoverUrl(isbn13: string): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`;
}

const clean = (text: unknown): string | undefined => {
  if (typeof text !== 'string') return undefined;
  // BnF titles carry non-sorting markers (C1 control characters) around leading articles.
  const value = text.replace(/[\u0080-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  return value || undefined;
};

const yearOf = (date: unknown): number | undefined => {
  const match = typeof date === 'string' ? /\b(1[4-9]\d\d|20\d\d)\b/.exec(date) : null;
  return match ? Number(match[1]) : undefined;
};

const LANGUAGES: Record<string, string> = {
  fre: 'fr',
  fra: 'fr',
  eng: 'en',
  ger: 'de',
  deu: 'de',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  dut: 'nl',
  nld: 'nl',
  lat: 'la',
};

const languageOf = (code: unknown): string | undefined => {
  const value = clean(code)?.toLowerCase();
  if (!value) return undefined;
  return LANGUAGES[value] ?? value;
};

const withoutEmpty = (record: SourceRecord): SourceRecord =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)),
  ) as unknown as SourceRecord;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(clean).filter((text): text is string => text !== undefined) : [];

export function parseGoogleBooks(json: unknown): SourceRecord | undefined {
  if (!isObject(json) || !Array.isArray(json.items)) return undefined;
  return googleBooksVolume(json.items[0]);
}

/** One volume of a Google Books answer (also the results of a search by title, see titleSearch.ts). */
export function googleBooksVolume(item: unknown): SourceRecord | undefined {
  if (!isObject(item) || !isObject(item.volumeInfo)) return undefined;
  const info = item.volumeInfo;
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers.filter(isObject) : [];
  const isbn10 = identifiers.find((identifier) => identifier.type === 'ISBN_10')?.identifier;
  const images = isObject(info.imageLinks) ? info.imageLinks : {};
  const thumbnail = clean(images.thumbnail ?? images.smallThumbnail);
  return withoutEmpty({
    provider: 'googleBooks',
    title: clean(info.title),
    authors: stringsOf(info.authors),
    publisher: clean(info.publisher),
    year: yearOf(info.publishedDate),
    language: languageOf(info.language),
    isbn10: clean(isbn10),
    coverUrl: thumbnail?.replace(/^http:/, 'https:').replace('&edge=curl', ''),
  });
}

export function parseOpenLibrary(json: unknown): SourceRecord | undefined {
  if (!isObject(json)) return undefined;
  const entry = Object.values(json)[0];
  if (!isObject(entry)) return undefined;
  const names = (list: unknown) => stringsOf(Array.isArray(list) ? list.filter(isObject).map((item) => item.name) : []);
  const identifiers = isObject(entry.identifiers) ? entry.identifiers : {};
  const cover = isObject(entry.cover) ? entry.cover : {};
  return withoutEmpty({
    provider: 'openLibrary',
    title: clean(entry.title),
    authors: names(entry.authors),
    publisher: names(entry.publishers)[0],
    year: yearOf(entry.publish_date),
    isbn10: stringsOf(identifiers.isbn_10)[0],
    coverUrl: clean(cover.large ?? cover.medium),
  });
}

const decodeXml = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

export interface UnimarcField {
  tag: string;
  subfields: { code: string; value: string }[];
}

/**
 * UNIMARC data fields of every record of an answer. The format is stable: no DOM needed (works in
 * tests). The BnF writes format="UNIMARC" (seen on 3 November 2026) or format="Unimarc": the case is ignored.
 */
export function unimarcRecords(xml: string): UnimarcField[][] {
  return Array.from(xml.matchAll(/<(?:\w+:)?record\b[^>]*format="unimarc"[^>]*>([\s\S]*?)<\/(?:\w+:)?record>/gi), ([, record = '']) => {
    const fields: UnimarcField[] = [];
    for (const [, tag = '', body = ''] of record.matchAll(
      /<(?:\w+:)?datafield\b[^>]*tag="(\d{3})"[^>]*>([\s\S]*?)<\/(?:\w+:)?datafield>/g,
    )) {
      const subfields = Array.from(
        body.matchAll(/<(?:\w+:)?subfield\b[^>]*code="(\w)"[^>]*>([\s\S]*?)<\/(?:\w+:)?subfield>/g),
        ([, code = '', value = '']) => ({ code, value: decodeXml(value) }),
      );
      fields.push({ tag, subfields });
    }
    return fields;
  });
}

/** First value of a subfield in a record, cleaned. */
export function unimarcValue(fields: readonly UnimarcField[], tag: string, code: string): string | undefined {
  return clean(fields.find((field) => field.tag === tag)?.subfields.find((subfield) => subfield.code === code)?.value);
}

/** Volume of a series: « 4 », « G 11 », « H13 », « 12 bis » → its first number. */
export function volumeNumber(text: string | undefined): number | undefined {
  const match = text ? /\d+/.exec(text) : null;
  return match ? Number(match[0]) : undefined;
}

export function parseBnf(xml: string): SourceRecord | undefined {
  return bnfRecord(unimarcRecords(xml)[0] ?? []);
}

/** One UNIMARC record of the BnF (also the results of a search by title, see titleSearch.ts). */
export function bnfRecord(fields: readonly UnimarcField[]): SourceRecord | undefined {
  if (fields.length === 0) return undefined;
  const sub = (tag: string, code: string) => unimarcValue(fields, tag, code);
  const all = (tag: string) => fields.filter((field) => field.tag === tag);
  const value = (field: UnimarcField, code: string) => clean(field.subfields.find((subfield) => subfield.code === code)?.value);

  // 700/701: authors (702 are translators, illustrators…); 710/711: corporate authors.
  const authors = [...all('700'), ...all('701')]
    .map((field) => [value(field, 'b'), value(field, 'a')].filter(Boolean).join(' '))
    .concat([...all('710'), ...all('711')].map((field) => value(field, 'a') ?? ''))
    .filter(Boolean);
  const title = [sub('200', 'a'), sub('200', 'e')].filter(Boolean).join(' : ');
  const isbn10 = sub('010', 'a')?.replace(/-/g, '');
  // 461 links to a series (bandes dessinées, multi-volume works); 225 is the publisher's collection
  // (« Folio ; 42 »), not a series.
  const seriesIndex = volumeNumber(sub('461', 'v'));

  return withoutEmpty({
    provider: 'bnf',
    title: title || undefined,
    authors: authors.length > 0 ? authors : stringsOf([sub('200', 'f')]),
    // Brackets mark a publisher deduced by the cataloguer: « [Librairie générale française] ».
    publisher: (sub('210', 'c') ?? sub('214', 'c'))?.replace(/^\[(.*)\]$/, '$1'),
    year: yearOf(sub('210', 'd') ?? sub('214', 'd')),
    language: languageOf(sub('101', 'a')),
    seriesName: sub('461', 't'),
    seriesIndex,
    isbn10: isbn10 && /^\d{9}[\dX]$/.test(isbn10) ? isbn10 : undefined,
  });
}
