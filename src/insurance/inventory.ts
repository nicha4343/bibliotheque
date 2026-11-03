import type { Book, Copy, Id, Loan } from '../db/schema';
import { foldText, sortKey } from '../library/filter';
import { isActive } from '../loans/loans';
import type { PlaceIndex } from '../places/places';
import { fr } from '../textes/fr';

// « Inventaire pour l’assurance » (lot 5, screen 11): what the PDF lists, worked out apart from its
// drawing so that it can be tested. Copies declared lost are left out (they are no longer at home);
// lent copies are listed, they still belong to the user.

export interface InventoryOptions {
  covers: boolean;
  prices: boolean;
  byPlace: boolean;
  photos: boolean;
}

export const DEFAULT_INVENTORY_OPTIONS: Readonly<InventoryOptions> = { covers: true, prices: true, byPlace: true, photos: false };

export interface InventoryItem {
  book: Book;
  /** Copies listed on this line (on this shelf, when classed by place). */
  copies: number;
  /** Borrower of one of these copies. */
  lentTo?: string;
  /** Where the copies are, when the list is classed by title. */
  places?: string[];
}

export interface InventoryGroup {
  /** Room, then shelf; none when classed by title. */
  room?: string;
  shelf?: string;
  items: InventoryItem[];
}

export interface InventorySummary {
  books: number;
  copies: number;
  rooms: number;
  shelves: number;
  /** Books whose purchase price is known, and the value of their copies. */
  priced: number;
  value: number;
  /** Copies declared lost, left out. */
  lost: number;
  /** User photographs of the precious editions. */
  photos: number;
}

export const isPrecious = (book: Pick<Book, 'tags'>): boolean => {
  const precious = new Set(fr.insurance.preciousTags.map(foldText));
  return book.tags.some((tag) => precious.has(foldText(tag)));
};

/** Precious editions photographed by the user (cover taken by the camera or chosen in the gallery). */
export const photographedPrecious = (books: readonly Book[]): Book[] =>
  books.filter((book) => isPrecious(book) && book.cover?.source === 'user' && book.cover.blobId).sort(byTitle);

const byTitle = (a: Book, b: Book) => sortKey(a.title).localeCompare(sortKey(b.title), 'fr') || a.createdAt - b.createdAt;

function present(copies: readonly Copy[]): Map<Id, Copy[]> {
  const byBook = new Map<Id, Copy[]>();
  for (const copy of copies) {
    if (copy.lostAt === undefined) byBook.set(copy.bookId, [...(byBook.get(copy.bookId) ?? []), copy]);
  }
  return byBook;
}

export function inventorySummary(books: readonly Book[], copies: readonly Copy[], places: PlaceIndex): InventorySummary {
  const byBook = present(copies);
  const owned = books.filter((book) => byBook.has(book.id));
  const kept = copies.filter((copy) => copy.lostAt === undefined);
  const priced = owned.filter((book) => book.price !== undefined);
  return {
    books: owned.length,
    copies: kept.length,
    rooms: new Set(kept.flatMap((copy) => places.byShelfId.get(copy.shelfId)?.room.id ?? [])).size,
    shelves: new Set(kept.map((copy) => copy.shelfId)).size,
    priced: priced.length,
    value: priced.reduce((total, book) => total + (book.price ?? 0) * (byBook.get(book.id)?.length ?? 0), 0),
    lost: copies.length - kept.length,
    photos: photographedPrecious(owned).length,
  };
}

function lentToOf(copies: readonly Copy[], loans: readonly Loan[]): string | undefined {
  const ids = new Set(copies.map((copy) => copy.id));
  return loans.find((loan) => ids.has(loan.copyId) && isActive(loan))?.borrower;
}

const itemOf = (book: Book, copies: readonly Copy[], loans: readonly Loan[]): InventoryItem => {
  const lentTo = lentToOf(copies, loans);
  return lentTo ? { book, copies: copies.length, lentTo } : { book, copies: copies.length };
};

/** The lines of the inventory, by room and shelf in their order, or by title. */
export function inventoryGroups(
  books: readonly Book[],
  copies: readonly Copy[],
  loans: readonly Loan[],
  places: PlaceIndex,
  byPlace: boolean,
): InventoryGroup[] {
  const byBook = present(copies);
  const owned = books.filter((book) => byBook.has(book.id)).sort(byTitle);
  if (!byPlace) {
    return [
      {
        items: owned.map((book) => {
          const own = byBook.get(book.id) ?? [];
          const labels = [...new Set(own.map((copy) => places.byShelfId.get(copy.shelfId)?.label ?? fr.library.noPlace))];
          return { ...itemOf(book, own, loans), places: labels };
        }),
      },
    ];
  }
  const groups: InventoryGroup[] = [];
  const shelfOf = (copy: Copy) => (places.byShelfId.has(copy.shelfId) ? copy.shelfId : '');
  const shelfIds = [...places.byShelfId.keys(), ''];
  for (const shelfId of shelfIds) {
    const items = owned.flatMap((book) => {
      const here = (byBook.get(book.id) ?? []).filter((copy) => shelfOf(copy) === shelfId);
      return here.length > 0 ? [itemOf(book, here, loans)] : [];
    });
    if (items.length === 0) continue;
    const place = places.byShelfId.get(shelfId);
    groups.push(place ? { room: place.room.name, shelf: place.shelf.name, items } : { room: fr.library.noPlace, items });
  }
  return groups;
}

// The standard fonts of a PDF write Windows-1252 (WinAnsi) only: other characters are replaced.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const REPLACEMENTS: Record<string, string> = {
  '\u202f': '\u00a0', // narrow no-break space of French typography
  '\u2009': ' ',
  '\u1d49': 'e', // superscript e of « 2e »
  '\u02b3': 'r',
  '\u2010': '-',
  '\u2011': '-',
  '\u2212': '-',
  '\u2032': "'",
  '\u2033': '"',
};

export function toWinAnsi(text: string): string {
  let result = '';
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(char)) {
      result += char;
      continue;
    }
    const replacement = REPLACEMENTS[char];
    if (replacement !== undefined) {
      result += replacement;
      continue;
    }
    // A letter with an accent unknown to WinAnsi keeps its base letter (« ō » → « o »).
    const base = char.normalize('NFD').replace(/\p{M}/gu, '');
    result += base !== char && /^[ -~]+$/.test(base) ? base : '?';
  }
  return result;
}
