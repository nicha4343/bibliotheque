import { describe, expect, it } from 'vitest';
import type { Book, Copy, Room, Shelf } from '../db/schema';
import { indexPlaces } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { inventoryGroups, inventorySummary, isPrecious, photographedPrecious, toWinAnsi } from './inventory';
import { makeInventoryPdf } from './pdf';

const rooms: Room[] = [
  { id: 'salon', name: 'Salon', order: 0 },
  { id: 'bureau', name: 'Bureau', order: 1 },
];
const shelves: Shelf[] = [
  { id: 'salon-1', roomId: 'salon', name: 'Étagère 1', order: 0, qrToken: 'a' },
  { id: 'salon-2', roomId: 'salon', name: 'Étagère 2', order: 1, qrToken: 'b' },
  { id: 'bureau-1', roomId: 'bureau', name: 'Bandes dessinées', order: 0, qrToken: 'c' },
];
const places = indexPlaces(rooms, shelves);

const book = (title: string, fields: Partial<Book> = {}): Book => newBook({ title, authors: ['Albert Camus'], ...fields });

function library(): { books: Book[]; copies: Copy[] } {
  const peste = book('La Peste', { price: 7.9, isbn13: '9782070360420' });
  const etranger = book('L’Étranger', { price: 6.5, tags: ['Dédicacé'], cover: { source: 'user', blobId: 'photo' } });
  const asterix = book('Astérix le Gaulois', { authors: ['René Goscinny'] });
  const perdu = book('Noces');
  const lost = { ...newCopy(perdu.id, 'salon-1'), lostAt: 1 };
  return {
    books: [peste, etranger, asterix, perdu],
    copies: [newCopy(peste.id, 'salon-1'), newCopy(peste.id, 'salon-2'), newCopy(etranger.id, 'salon-1'), newCopy(asterix.id, 'bureau-1'), lost],
  };
}

describe('inventaire pour l’assurance', () => {
  it('compte les ouvrages présents, leur valeur et les exemplaires perdus', () => {
    const { books, copies } = library();
    expect(inventorySummary(books, copies, places)).toEqual({
      books: 3,
      copies: 4,
      rooms: 2,
      shelves: 3,
      priced: 2,
      value: 7.9 * 2 + 6.5,
      lost: 1,
      photos: 1,
    });
  });

  it('classe les ouvrages par pièce et par étagère, dans leur ordre, ou par titre', () => {
    const { books, copies } = library();
    const byPlace = inventoryGroups(books, copies, [], places, true);
    expect(byPlace.map((group) => [group.room, group.shelf, group.items.map((item) => `${item.book.title}×${item.copies}`)])).toEqual([
      ['Salon', 'Étagère 1', ['L’Étranger×1', 'La Peste×1']],
      ['Salon', 'Étagère 2', ['La Peste×1']],
      ['Bureau', 'Bandes dessinées', ['Astérix le Gaulois×1']],
    ]);
    const [byTitle] = inventoryGroups(books, copies, [], places, false);
    expect(byTitle?.items.map((item) => [item.book.title, item.copies, item.places])).toEqual([
      ['Astérix le Gaulois', 1, ['Bureau · Bandes dessinées']],
      ['L’Étranger', 1, ['Salon · Étagère 1']],
      ['La Peste', 2, ['Salon · Étagère 1', 'Salon · Étagère 2']],
    ]);
  });

  it('reconnaît les éditions précieuses photographiées', () => {
    const { books } = library();
    expect(books.filter(isPrecious).map((item) => item.title)).toEqual(['L’Étranger']);
    expect(photographedPrecious(books).map((item) => item.title)).toEqual(['L’Étranger']);
  });

  it('écrit les caractères que les polices du PDF ne connaissent pas', () => {
    const narrow = String.fromCharCode(0x202f);
    const noBreak = String.fromCharCode(0xa0);
    expect(toWinAnsi(`2ᵉ étage${narrow}; « Œuvres » – 12,50 €`)).toBe(`2e étage${noBreak}; « Œuvres » – 12,50 €`);
    expect(toWinAnsi('Tōkyō 東京')).toBe('Tokyo ??');
  });

  it('produit un PDF lisible, sans erreur d’encodage', async () => {
    const { books, copies } = library();
    const summary = inventorySummary(books, copies, places);
    const progress: number[] = [];
    const { bytes, pages } = await makeInventoryPdf({
      summary,
      groups: inventoryGroups(books, copies, [{ id: 'l', copyId: copies[3]?.id ?? '', borrower: 'Sam', lentAt: 1, dueAt: 2 }], places, true),
      photographed: photographedPrecious(books),
      options: { covers: true, prices: true, byPlace: true, photos: true },
      now: new Date(2026, 10, 3),
      loadImage: () => Promise.resolve(undefined),
      onProgress: (done) => progress.push(done),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(pages).toBe(1);
    expect(progress.at(-1)).toBe(4);
  });
});
