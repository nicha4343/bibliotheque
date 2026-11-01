import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Shelf } from '../db/schema';
import { createRoom, createShelf } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { addCopy, deleteBook, moveCopy, removeCopy, setAutoCover, setUserCover, updateBook } from './books';

let database: LibraryDatabase;
let shelf: Shelf;
let book: Book;

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  ({ shelf } = await createRoom('Salon', database));
  book = newBook({ isbn13: '9782070360420', title: 'La Peste', authors: ['Albert Camus'], publisher: 'Folio' });
  await database.books.add(book);
  await database.copies.add(newCopy(book.id, shelf.id));
});

afterEach(async () => {
  await database.delete();
});

describe('fiche ouvrage', () => {
  it('retire un champ facultatif laissé vide', async () => {
    await updateBook(book.id, { publisher: undefined, status: 'read' }, database);
    const updated = await database.books.get(book.id);
    expect(updated?.publisher).toBeUndefined();
    expect(updated?.status).toBe('read');
  });

  it('remplace la couverture automatique par la photographie, sans laisser d’image orpheline', async () => {
    await setAutoCover(book.id, { provider: 'openLibrary', url: 'https://example.org/c.jpg', blob: new Blob(['auto']) }, database);
    await setUserCover(book.id, new Blob(['photo']), database);
    const updated = await database.books.get(book.id);
    expect(updated?.cover?.source).toBe('user');
    expect(await database.blobs.count()).toBe(1);
  });

  it('ajoute, déplace et retire des exemplaires, sauf le dernier', async () => {
    const other = await createShelf(shelf.roomId, undefined, database);
    await addCopy(book.id, other.id, database);
    const copies = await database.copies.where('bookId').equals(book.id).sortBy('addedAt');
    expect(copies).toHaveLength(2);
    await moveCopy(copies[0]?.id ?? '', other.id, database);
    expect((await database.copies.get(copies[0]?.id ?? ''))?.shelfId).toBe(other.id);
    expect(await removeCopy(copies[1]?.id ?? '', database)).toBe(true);
    expect(await removeCopy(copies[0]?.id ?? '', database)).toBe(false);
  });

  it('supprime la notice avec ses exemplaires et sa couverture', async () => {
    await setUserCover(book.id, new Blob(['photo']), database);
    await deleteBook(book.id, database);
    expect(await database.books.count()).toBe(0);
    expect(await database.copies.count()).toBe(0);
    expect(await database.blobs.count()).toBe(0);
  });
});
