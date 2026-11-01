import { db, type LibraryDatabase } from '../db/db';
import type { Id } from '../db/schema';
import { foldText } from '../library/filter';

// « Étiquettes » of the book sheet (screen 6): free keywords, with suggestions.

/** « Format   poche » → « Format poche ». */
export function cleanTag(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

const sameTag = (a: string, b: string) => foldText(a) === foldText(b);

/** The tag is added unless the book already has it, whatever its case or accents. */
export function withTag(tags: readonly string[], label: string): string[] {
  const tag = cleanTag(label);
  if (!tag || tags.some((existing) => sameTag(existing, tag))) return [...tags];
  return [...tags, tag];
}

/**
 * Suggestions under the field: the usual tags, then those already used in the library, except the
 * book's own; while the user types, only those containing the typed text.
 */
export function suggestTags(
  bookTags: readonly string[],
  usual: readonly string[],
  used: readonly string[],
  draft: string,
  limit = 12,
): string[] {
  const seen = new Set(bookTags.map(foldText));
  const query = foldText(draft);
  const suggestions: string[] = [];
  for (const tag of [...usual, ...used]) {
    const key = foldText(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    if (query && !key.includes(query)) continue;
    suggestions.push(tag);
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

/** Tags already given to at least one book, in alphabetical order. */
export async function usedTags(database: LibraryDatabase = db): Promise<string[]> {
  const keys = await database.books.orderBy('tags').uniqueKeys();
  return keys.map(String).sort((a, b) => a.localeCompare(b, 'fr'));
}

// Read and written in one transaction, so that two quick touches never lose a tag.
async function changeTags(bookId: Id, change: (tags: string[]) => string[], database: LibraryDatabase): Promise<void> {
  await database.transaction('rw', database.books, async () => {
    const book = await database.books.get(bookId);
    if (!book) return;
    const tags = change(book.tags);
    if (tags.length === book.tags.length && tags.every((tag, index) => tag === book.tags[index])) return;
    await database.books.update(bookId, { tags, updatedAt: Date.now() });
  });
}

export const addTag = (bookId: Id, label: string, database: LibraryDatabase = db) =>
  changeTags(bookId, (tags) => withTag(tags, label), database);

export const removeTag = (bookId: Id, label: string, database: LibraryDatabase = db) =>
  changeTags(bookId, (tags) => tags.filter((tag) => tag !== label), database);
