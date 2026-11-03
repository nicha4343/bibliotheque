import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book } from '../db/schema';
import { newBook, newCopy } from '../scan/session';
import { groupSeries } from '../series/series';
import { bookshopDetails, classifyBookshop, loadBookshopCheck } from './bookshop';
import { decodeWishList, encodeWishList, sharedListUrl } from './share';
import {
  acquiredWishes,
  addWish,
  newWish,
  removeAcquiredWishes,
  sortWishes,
  toggleVolumeWish,
  wishMissingVolumes,
} from './wishes';

let database: LibraryDatabase;

beforeEach(() => {
  database = new LibraryDatabase(`test-${newId()}`);
});

afterEach(async () => {
  await database.delete();
});

const book = (title: string, fields: Partial<Book> = {}): Book => newBook({ title, authors: ['Georges Perec'], ...fields });

describe('souhaits réalisés', () => {
  it('reconnaissent l’ouvrage entré dans la bibliothèque par l’ISBN, le tome ou le titre', () => {
    const wishes = [
      newWish({ title: 'Les Choses', author: 'Georges Perec', source: 'manual' }),
      newWish({ title: 'Astérix, tome 4', source: 'series', seriesName: 'Astérix', seriesIndex: 4 }),
      newWish({ title: '', isbn: '9782070360024', source: 'bookshop' }),
      newWish({ title: 'W ou le souvenir d’enfance', author: 'Georges Perec', source: 'author' }),
    ];
    const books = [
      book('Les choses : une histoire des années soixante'),
      book('Astérix gladiateur', { seriesName: 'asterix', seriesIndex: 4 }),
      book('L’Étranger', { isbn13: '9782070360024', authors: ['Albert Camus'] }),
      book('W ou le souvenir d’enfance', { authors: ['Autre auteur'] }),
    ];
    expect(acquiredWishes(wishes, books).map((wish) => wish.title)).toEqual(['Les Choses', 'Astérix, tome 4', '']);
  });

  it('sont retirés de la liste', async () => {
    await database.wishes.bulkAdd([newWish({ title: 'Les Choses', source: 'manual' }), newWish({ title: 'Espèces d’espaces', source: 'manual' })]);
    await database.books.add(book('Les Choses'));
    expect(await removeAcquiredWishes(database)).toBe(1);
    expect((await database.wishes.toArray()).map((wish) => wish.title)).toEqual(['Espèces d’espaces']);
  });
});

describe('ajout d’un souhait', () => {
  it('ne crée pas deux fois le même souhait', async () => {
    const first = await addWish({ title: 'Les Choses', author: 'Georges Perec', source: 'manual' }, database);
    const again = await addWish({ title: 'Les choses', author: 'Georges Perec', source: 'author', isbn: '9782266028882' }, database);
    expect(again).toEqual({ wish: first.wish, created: false });
    expect(first.created).toBe(true);
    expect(await database.wishes.count()).toBe(1);
  });

  it('classe les tomes d’une série ensemble et dans l’ordre', () => {
    const wishes = [
      newWish({ title: 'Astérix, tome 12', source: 'series', seriesName: 'Astérix', seriesIndex: 12 }),
      newWish({ title: 'Les Choses', source: 'manual' }),
      newWish({ title: 'Astérix, tome 4', source: 'series', seriesName: 'Astérix', seriesIndex: 4 }),
    ];
    expect(sortWishes(wishes).map((wish) => wish.title)).toEqual(['Astérix, tome 4', 'Astérix, tome 12', 'Les Choses']);
  });
});

describe('tomes manquants', () => {
  const books = [
    book('Astérix le Gaulois', { seriesName: 'Astérix', seriesIndex: 1, authors: ['René Goscinny'] }),
    book('Astérix gladiateur', { seriesName: 'Astérix', seriesIndex: 4, authors: ['René Goscinny'] }),
  ];

  it('s’ajoutent aux souhaits ou s’en retirent d’un toucher', async () => {
    const [group] = groupSeries(books);
    if (!group) throw new Error('series expected');
    expect(await toggleVolumeWish(group, 2, database)).toBe(true);
    expect(await database.wishes.toArray()).toMatchObject([
      { title: 'Astérix, tome 2', author: 'René Goscinny', source: 'series', seriesName: 'Astérix', seriesIndex: 2 },
    ]);
    expect(await toggleVolumeWish(group, 2, database)).toBe(false);
    expect(await database.wishes.count()).toBe(0);
  });

  it('s’ajoutent tous à la fois, sans doublon', async () => {
    const [group] = groupSeries(books);
    if (!group) throw new Error('series expected');
    await toggleVolumeWish(group, 3, database);
    expect(await wishMissingVolumes(group, database)).toBe(1);
    expect(sortWishes(await database.wishes.toArray()).map((wish) => wish.seriesIndex)).toEqual([2, 3]);
  });
});

describe('partage de la liste', () => {
  it('fait tenir la liste dans le lien et la relit telle quelle', async () => {
    const list = {
      name: 'Nicolas',
      date: '2026-11-03',
      wishes: [{ title: 'Les Choses', author: 'Georges Perec', isbn: '9782266028882' }, { title: 'Astérix, tome 4' }, { title: 'W', isbn: '9782070000000' }],
    };
    const payload = await encodeWishList(list);
    expect(payload).toMatch(/^[\w-]+$/);
    expect(await decodeWishList(payload)).toEqual(list);
  });

  it('refuse un lien tronqué ou altéré', async () => {
    const payload = await encodeWishList({ name: '', date: '2026-11-03', wishes: [{ title: 'Les Choses' }] });
    expect(await decodeWishList(payload.slice(0, -6))).toBeUndefined();
    expect(await decodeWishList('abc')).toBeUndefined();
  });

  it('forme l’adresse à partir de celle de l’application', () => {
    expect(sharedListUrl('https://nicha4343.github.io/bibliotheque/#/listes/souhaits', '#/souhaits/xyz')).toBe(
      'https://nicha4343.github.io/bibliotheque/#/souhaits/xyz',
    );
  });
});

describe('vérification en librairie', () => {
  it('signale un ouvrage possédé, avec l’emprunteur s’il est prêté', async () => {
    const owned = book('Les Choses', { isbn13: '9782266028882' });
    const copy = newCopy(owned.id, 'salon');
    await database.books.add(owned);
    await database.copies.add(copy);
    await database.loans.add({ id: newId(), copyId: copy.id, borrower: 'Sam', lentAt: 1, dueAt: 2 });
    expect(await loadBookshopCheck('9782266028882', database)).toMatchObject({ kind: 'owned', lentTo: 'Sam', copies: [{ id: copy.id }] });
  });

  it('signale un ouvrage souhaité par son ISBN, sinon absent', () => {
    const wish = newWish({ title: 'W', isbn: '9782070000000', source: 'manual' });
    expect(classifyBookshop('9782070000000', [], [], [wish])).toEqual({ kind: 'wished', wish });
    expect(classifyBookshop('9782266028882', [], [], [wish])).toEqual({ kind: 'absent' });
  });

  it('rattache un ouvrage absent à une série de la bibliothèque et au souhait de son tome', () => {
    const books = [book('Astérix le Gaulois', { seriesName: 'Astérix', seriesIndex: 1 })];
    const wish = newWish({ title: 'Astérix, tome 2', source: 'series', seriesName: 'Astérix', seriesIndex: 2 });
    const details = bookshopDetails(
      { isbn13: '9782012101333', title: 'Astérix - Tome 2 - La Serpe d’or', authors: ['René Goscinny'], providers: ['bnf'] },
      books,
      [wish],
    );
    expect(details.series).toEqual({ name: 'Astérix', index: 2 });
    expect(details.group?.name).toBe('Astérix');
    expect(details.wish?.id).toBe(wish.id);
  });
});
