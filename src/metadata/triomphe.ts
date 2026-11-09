import type { SourceRecord } from './sources';

// The list of the Éditions du Triomphe (editionsdutriomphe.fr): the 820 books it sold on 3 November
// 2026, its own and some of other publishers (Mame, Casterman, Gallimard…), with the authors and the
// publisher read on the page of each book on 9 November 2026. Asked by the user that day: its recent
// books (2025, 2026) are unknown to the BnF for months and to Open Library, and Google Books often
// lacks their publisher and authors. Inside the application: no request, so it always answers.

/** Changes when the list is read again from the site: the notices are then completed once more. */
export const TRIOMPHE_EDITION = '2026-11-09';

/** One book of the list; a field the page of the book does not give is absent. */
export interface TriompheEntry {
  title: string;
  authors?: string[];
  publisher?: string;
  year?: number;
}

export type TriompheCatalog = Readonly<Record<string, TriompheEntry>>;

let catalog: Promise<TriompheCatalog> | undefined;

/** A separate file of the build, loaded at the first search only (precached: available offline). */
export function loadTriompheCatalog(): Promise<TriompheCatalog> {
  catalog ??= import('./triomphe.json').then(
    (module) => module.default as TriompheCatalog,
    (error: unknown) => {
      // Tried again at the next search.
      catalog = undefined;
      throw error;
    },
  );
  return catalog;
}

export function triompheRecord(entry: TriompheEntry): SourceRecord {
  const record: SourceRecord = { provider: 'triomphe', title: entry.title };
  if (entry.authors && entry.authors.length > 0) record.authors = entry.authors;
  if (entry.publisher) record.publisher = entry.publisher;
  if (entry.year) record.year = entry.year;
  return record;
}

/** What the list knows about an ISBN-13; undefined when the book is not in it. */
export async function findInTriompheCatalog(isbn13: string): Promise<SourceRecord | undefined> {
  const entry = (await loadTriompheCatalog())[isbn13];
  return entry ? triompheRecord(entry) : undefined;
}
