import { db, type LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Id, Quote } from '../db/schema';

// « Citations » of the book sheet (screen 6): a photographed passage, its text typed by the user if
// they wish (reading the text from the photograph comes with lot 6).

export async function bookQuotes(bookId: Id, database: LibraryDatabase = db): Promise<Quote[]> {
  return database.quotes.where('bookId').equals(bookId).sortBy('createdAt');
}

export async function addQuote(
  bookId: Id,
  { text = '', photo }: { text?: string; photo?: Blob },
  database: LibraryDatabase = db,
): Promise<Quote> {
  return database.transaction('rw', database.quotes, database.blobs, async () => {
    const now = Date.now();
    const quote: Quote = { id: newId(), bookId, text: text.trim(), createdAt: now };
    if (photo) {
      quote.photoBlobId = newId();
      await database.blobs.add({ id: quote.photoBlobId, blob: photo, createdAt: now });
    }
    await database.quotes.add(quote);
    return quote;
  });
}

export async function updateQuote(quoteId: Id, text: string, database: LibraryDatabase = db): Promise<void> {
  await database.quotes.update(quoteId, { text: text.trim() });
}

/** The quote and its photograph. */
export async function deleteQuote(quoteId: Id, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.quotes, database.blobs, async () => {
    const quote = await database.quotes.get(quoteId);
    if (quote?.photoBlobId) await database.blobs.delete(quote.photoBlobId);
    await database.quotes.delete(quoteId);
  });
}

/** Every quote of a book and their photographs; called within deleteBook's transaction. */
export async function deleteBookQuotes(bookId: Id, database: LibraryDatabase): Promise<void> {
  const quotes = await database.quotes.where('bookId').equals(bookId).toArray();
  await database.blobs.bulkDelete(quotes.flatMap((quote) => (quote.photoBlobId ? [quote.photoBlobId] : [])));
  await database.quotes.bulkDelete(quotes.map((quote) => quote.id));
}
