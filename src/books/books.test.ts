import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Shelf } from '../db/schema';
import { createRoom, createShelf } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { addCopy, deleteBook, moveCopy, removeCopy, setAutoCover, setUserCover, updateBook } from './books';
import { addQuote, bookQuotes, deleteQuote, updateQuote } from './quotes';
import { addTag, removeTag, suggestTags, usedTags, withTag } from './tags';

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

  it('supprime la notice avec ses exemplaires, sa couverture et ses citations', async () => {
    await setUserCover(book.id, new Blob(['photo']), database);
    await addQuote(book.id, { photo: new Blob(['passage']) }, database);
    await deleteBook(book.id, database);
    expect(await database.books.count()).toBe(0);
    expect(await database.copies.count()).toBe(0);
    expect(await database.quotes.count()).toBe(0);
    expect(await database.blobs.count()).toBe(0);
  });

  it('enregistre la note et l’avis', async () => {
    await updateBook(book.id, { rating: 4, review: 'D’une force intacte.' }, database);
    const updated = await database.books.get(book.id);
    expect(updated?.rating).toBe(4);
    expect(updated?.review).toBe('D’une force intacte.');
  });
});

describe('étiquettes', () => {
  it('n’ajoute pas deux fois la même étiquette, quels que soient la casse et les accents', () => {
    expect(withTag(['Abîmé'], 'abime')).toEqual(['Abîmé']);
    expect(withTag(['Abîmé'], '  Format   poche ')).toEqual(['Abîmé', 'Format poche']);
    expect(withTag(['Abîmé'], '   ')).toEqual(['Abîmé']);
  });

  it('propose les étiquettes usuelles puis celles déjà employées, sauf celles de l’ouvrage', () => {
    const usual = ['Dédicacé', 'Cadeau', 'À relire'];
    expect(suggestTags(['cadeau'], usual, ['Cadeau', 'Polar'], '')).toEqual(['Dédicacé', 'À relire', 'Polar']);
    expect(suggestTags([], usual, ['Polar'], 'dedi')).toEqual(['Dédicacé']);
    expect(suggestTags([], usual, ['Polar'], 'R')).toEqual(['À relire', 'Polar']);
  });

  it('ajoute et retire les étiquettes d’un ouvrage ; la liste des étiquettes employées s’en déduit', async () => {
    await addTag(book.id, 'Format poche', database);
    await addTag(book.id, 'Dédicacé', database);
    await addTag(book.id, 'dédicacé', database);
    expect((await database.books.get(book.id))?.tags).toEqual(['Format poche', 'Dédicacé']);
    expect(await usedTags(database)).toEqual(['Dédicacé', 'Format poche']);
    await removeTag(book.id, 'Format poche', database);
    expect((await database.books.get(book.id))?.tags).toEqual(['Dédicacé']);
    expect(await usedTags(database)).toEqual(['Dédicacé']);
  });
});

describe('citations', () => {
  it('ajoute une citation photographiée, en modifie le texte puis la supprime avec sa photographie', async () => {
    const quote = await addQuote(book.id, { photo: new Blob(['passage']) }, database);
    expect(quote.text).toBe('');
    expect(await database.blobs.count()).toBe(1);
    await updateQuote(quote.id, '  Aujourd’hui, maman est morte. ', database);
    await addQuote(book.id, { text: 'Il faut imaginer Sisyphe heureux.' }, database);
    const quotes = await bookQuotes(book.id, database);
    expect(quotes.map((item) => item.text).sort()).toEqual(['Aujourd’hui, maman est morte.', 'Il faut imaginer Sisyphe heureux.']);
    await deleteQuote(quote.id, database);
    expect(await database.quotes.count()).toBe(1);
    expect(await database.blobs.count()).toBe(0);
  });
});
