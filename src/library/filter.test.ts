import { describe, expect, it } from 'vitest';
import type { Book, Copy } from '../db/schema';
import { foldText, matchesPlace, matchesQuery, matchesStatus, sortKey, toEntries } from './filter';

const book = (id: string, title: string, authors: string[], extra: Partial<Book> = {}): Book => ({
  id,
  title,
  authors,
  status: 'toread',
  rating: 0,
  review: '',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const copy = (id: string, bookId: string, shelfId: string, addedAt = 0): Copy => ({ id, bookId, shelfId, addedAt });

const books = [
  book('a', 'L’Étranger', ['Albert Camus'], { isbn13: '9782070360024', status: 'read' }),
  book('b', 'Les Misérables', ['Victor Hugo']),
  book('c', 'Belle du Seigneur', ['Albert Cohen']),
];
const entries = toEntries(books, [copy('1', 'a', 'salon-1'), copy('2', 'a', 'chambre-1', 5), copy('3', 'b', 'salon-2')]);
const find = (id: string) => entries.find((entry) => entry.book.id === id);

describe('recherche dans la bibliothèque', () => {
  it('ignore les accents et la casse', () => {
    expect(foldText('  Éléphant’S ')).toBe("elephant's");
    expect(entries.filter((e) => matchesQuery(e, 'miserables')).map((e) => e.book.id)).toEqual(['b']);
    expect(entries.filter((e) => matchesQuery(e, 'ALBERT')).map((e) => e.book.id).sort()).toEqual(['a', 'c']);
  });

  it('exige chacun des mots saisis', () => {
    expect(entries.filter((e) => matchesQuery(e, 'albert camus')).map((e) => e.book.id)).toEqual(['a']);
    expect(entries.filter((e) => matchesQuery(e, '')).length).toBe(3);
  });

  it('retrouve un ISBN saisi avec des tirets', () => {
    expect(entries.filter((e) => matchesQuery(e, '978-2-07-036002-4')).map((e) => e.book.id)).toEqual(['a']);
    expect(entries.filter((e) => matchesQuery(e, '036002')).map((e) => e.book.id)).toEqual(['a']);
  });

  it('classe par titre, sans tenir compte de l’article', () => {
    expect(sortKey('L’Étranger')).toBe('etranger');
    expect(entries.map((e) => e.book.id)).toEqual(['c', 'a', 'b']);
  });

  it('filtre par étagère, par pièce et par statut', () => {
    const a = find('a');
    const b = find('b');
    if (!a || !b) throw new Error('missing entries');
    expect(a.copies.map((c) => c.id)).toEqual(['1', '2']);
    expect(matchesPlace(a, { kind: 'shelf', shelfId: 'chambre-1' })).toBe(true);
    expect(matchesPlace(b, { kind: 'shelf', shelfId: 'chambre-1' })).toBe(false);
    expect(matchesPlace(b, { kind: 'room', shelfIds: new Set(['salon-1', 'salon-2']) })).toBe(true);
    expect(matchesStatus(a, 'read')).toBe(true);
    expect(matchesStatus(b, 'read')).toBe(false);
    expect(matchesStatus(b, 'all')).toBe(true);
  });
});
