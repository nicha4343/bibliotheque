import { describe, expect, it } from 'vitest';
import type { Book } from '../db/schema';
import { newBook } from '../scan/session';
import { missingWorks, parseAuthorWorks, workKey } from './authorWorks';
import { authorKey, booksOfAuthor, groupSeries, matchesSeries, seriesFromTitle, seriesKey, seriesOf, volumeCells } from './series';

const book = (title: string, fields: Partial<Book> = {}): Book => newBook({ title, authors: ['René Goscinny'], ...fields });

describe('seriesFromTitle', () => {
  it('lit la série et le tome indiqués par le titre', () => {
    expect(seriesFromTitle('Blake et Mortimer - Tome 1 - Le Secret de l’Espadon')).toEqual({ name: 'Blake et Mortimer', index: 1 });
    expect(seriesFromTitle('Les Misérables, tome 2 : Cosette')).toEqual({ name: 'Les Misérables', index: 2 });
    expect(seriesFromTitle('Tintin (vol. 5)')).toEqual({ name: 'Tintin', index: 5 });
    expect(seriesFromTitle('Astérix - n°12')).toEqual({ name: 'Astérix', index: 12 });
    expect(seriesFromTitle('Naruto T03')).toEqual({ name: 'Naruto', index: 3 });
    expect(seriesFromTitle('One Piece T.100 - Le Roi')).toEqual({ name: 'One Piece', index: 100 });
  });

  it('ignore les titres qui ne désignent pas un tome', () => {
    expect(seriesFromTitle('La Peste')).toBeUndefined();
    expect(seriesFromTitle('Le Livre de la jungle')).toBeUndefined();
    expect(seriesFromTitle('Tome 3')).toBeUndefined();
    expect(seriesFromTitle('Les Trois Mousquetaires T comme Tartempion')).toBeUndefined();
    expect(seriesFromTitle('1984')).toBeUndefined();
  });
});

describe('seriesOf', () => {
  it('préfère la série donnée, complétée du tome lu dans le titre', () => {
    expect(seriesOf(book('Astérix le Gaulois', { seriesName: 'Astérix', seriesIndex: 1 }))).toEqual({ name: 'Astérix', index: 1 });
    expect(seriesOf(book('Astérix - Tome 3 - Astérix chez les Goths', { seriesName: 'Astérix' }))).toEqual({ name: 'Astérix', index: 3 });
    expect(seriesOf(book('Tintin, tome 3', { seriesName: 'Mes bandes dessinées' }))).toEqual({ name: 'Mes bandes dessinées' });
  });

  it('respecte une série retirée par l’utilisateur', () => {
    expect(seriesOf(book('Naruto T03', { seriesName: '' }))).toBeUndefined();
    expect(seriesOf(book('Naruto T03'))).toEqual({ name: 'Naruto', index: 3 });
  });
});

describe('groupSeries', () => {
  const asterix = [
    book('Astérix le Gaulois', { seriesName: 'Astérix', seriesIndex: 1, publisher: 'Dargaud' }),
    book('La Serpe d’or', { seriesName: 'Astérix', seriesIndex: 2 }),
    book('Astérix et les Goths', { seriesName: 'asterix', seriesIndex: 3, publisher: 'Dargaud' }),
    book('Astérix gladiateur', { seriesName: 'Astérix.', seriesIndex: 5 }),
    book('Astérix et la Rentrée gauloise', { seriesName: 'Astérix' }),
  ];

  it('regroupe les notices d’une même série, quelle que soit l’écriture du nom', () => {
    const [group] = groupSeries(asterix);
    expect(group?.name).toBe('Astérix');
    expect(group?.key).toBe(seriesKey('ASTÉRIX'));
    expect(group?.volumes.map((volume) => volume.index)).toEqual([1, 2, 3, 5, undefined]);
    expect(group?.publisher).toBe('Dargaud');
    expect(group?.authors).toEqual(['René Goscinny']);
  });

  it('compte les tomes possédés et manquants, jusqu’au nombre déclaré', () => {
    const [found] = groupSeries(asterix);
    expect(found).toMatchObject({ total: 5, owned: 4, missing: [4] });
    const [declared] = groupSeries(asterix, [{ id: seriesKey('Astérix'), total: 7 }]);
    expect(declared).toMatchObject({ total: 7, owned: 4, missing: [4, 6, 7], declaredTotal: 7 });
    // A volume beyond the number declared counts: the series has grown.
    const [grown] = groupSeries(asterix, [{ id: seriesKey('Astérix'), total: 3 }]);
    expect(grown).toMatchObject({ total: 5, missing: [4] });
  });

  it('ne déclare rien manquant quand les numéros ne forment pas une suite', () => {
    const [group] = groupSeries([book('Spirou 2019', { seriesName: 'Le Journal de Spirou', seriesIndex: 2019 })]);
    expect(group).toMatchObject({ total: 0, owned: 0, missing: [] });
  });

  it('présente les tomes et les manquants dans l’ordre', () => {
    const [group] = groupSeries(asterix);
    expect(group && volumeCells(group).map((cell) => `${cell.kind}:${cell.index}`)).toEqual([
      'owned:1',
      'owned:2',
      'owned:3',
      'missing:4',
      'owned:5',
    ]);
  });

  it('classe les séries par nom, sans l’article', () => {
    const groups = groupSeries([book('Naruto T03'), book('Les Rougon-Macquart, tome 4'), book('Astérix - Tome 1')]);
    expect(groups.map((group) => group.name)).toEqual(['Astérix', 'Naruto', 'Les Rougon-Macquart']);
  });
});

describe('recherche dans « Séries »', () => {
  const groups = groupSeries([
    book('Astérix le Gaulois', { seriesName: 'Astérix', seriesIndex: 1, authors: ['René Goscinny', 'Albert Uderzo'] }),
    book('La Curée', { seriesName: 'Les Rougon-Macquart', seriesIndex: 2, authors: ['Émile Zola'] }),
    book('Harry Potter à l’école des sorciers', { seriesName: 'Harry Potter', seriesIndex: 1, authors: ['J. K. Rowling'] }),
  ]);
  const found = (query: string) => groups.filter((group) => matchesSeries(group, query)).map((group) => group.name);

  it('retrouve une série par son nom, sans tenir compte des accents ni des majuscules', () => {
    expect(found('ASTERIX')).toEqual(['Astérix']);
    expect(found('rougon macquart')).toEqual(['Les Rougon-Macquart']);
    expect(found('Rougon-Macq')).toEqual(['Les Rougon-Macquart']);
  });

  it('retrouve une série par le nom de l’un de ses auteurs', () => {
    expect(found('uderzo')).toEqual(['Astérix']);
    expect(found('emile zola')).toEqual(['Les Rougon-Macquart']);
    expect(found('J.K. Rowling')).toEqual(['Harry Potter']);
  });

  it('exige chaque mot et montre tout quand rien n’est saisi', () => {
    expect(found('astérix zola')).toEqual([]);
    expect(found('  ')).toHaveLength(3);
  });
});

describe('auteurs', () => {
  it('reconnaissent un même auteur malgré les points et les espaces', () => {
    expect(authorKey('J.K. Rowling')).toBe(authorKey('J. K. Rowling'));
    const books = [book('B', { authors: ['J. K. Rowling'] }), book('A', { authors: ['J.K. Rowling', 'X'] }), book('C')];
    expect(booksOfAuthor(books, 'J.K. Rowling').map((item) => item.title)).toEqual(['A', 'B']);
  });
});

describe('autres ouvrages d’un auteur (Open Library)', () => {
  const answer = {
    docs: [
      {
        key: '/works/OL1W',
        title: 'L’étranger',
        first_publish_year: 1942,
        author_name: ['Albert Camus'],
        editions: { docs: [{ title: 'L’étranger', language: ['fre'], isbn: ['2070360024'] }] },
      },
      {
        key: '/works/OL2W',
        title: 'La Peste',
        first_publish_year: 1947,
        author_name: ['Albert Camus'],
        editions: { docs: [{ title: 'La peste.', language: ['fre'] }] },
      },
      { key: '/works/OL3W', title: 'The Plague', author_name: ['Albert Camus'], editions: { docs: [{ title: 'The Plague', language: ['eng'] }] } },
      { key: '/works/OL4W', title: 'Camus', author_name: ['Olivier Todd'], editions: { docs: [{ title: 'Camus', language: ['fre'] }] } },
      { key: '/works/OL5W', title: 'La Peste', author_name: ['Albert Camus'], editions: { docs: [{ title: 'La Peste : roman', language: ['fre'] }] } },
    ],
  };

  it('retiennent les œuvres de l’auteur parues en français, sans doublon', () => {
    const works = parseAuthorWorks(answer, 'Albert Camus');
    expect(works).toEqual([
      { key: '/works/OL1W', title: 'L’étranger', year: 1942, isbn13: '9782070360024' },
      { key: '/works/OL2W', title: 'La peste', year: 1947 },
    ]);
  });

  it('écartent celles que la bibliothèque possède, par l’ISBN ou par le titre', () => {
    const works = parseAuthorWorks(answer, 'Albert Camus');
    expect(missingWorks(works, [book('La Peste : roman')]).map((work) => work.title)).toEqual(['L’étranger']);
    expect(missingWorks(works, [book('Autre titre', { isbn13: '9782070360024' })]).map((work) => work.title)).toEqual(['La peste']);
    expect(workKey('L’Étranger (Folio)')).toBe(workKey('étranger'));
  });
});
