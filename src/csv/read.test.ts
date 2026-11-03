import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parsePrice, readDate, readLibraryFile } from './read';

const read = (text: string) => readLibraryFile(parseCsv(text));

// Header of a real Libib export (1er novembre 2026); the rows are made up.
const LIBIB = [
  'id,item_type,title,creators,first_name,last_name,collection,ean_isbn13,upc_isbn10,description,publisher,publish_date,group,tags,notes,price,length,number_of_discs,number_of_players,age_group,ensemble,aspect_ratio,esrb,rating,review,review_date,status,began,completed,added,copies',
  'a1,book,La Peste,Albert Camus,Albert,Camus,Salon,9782070360420,2070360423,"Un ""grand"" roman",Gallimard,1972-01-01,,"classique, poche",Dédicacé,,,,,,,,,4,Magnifique,,Completed,,,2023-03-15,2',
  'a2,book,Astérix le Gaulois,"René Goscinny, Albert Uderzo",René,Goscinny,Salon,9782012101333,,,Hachette,2004,Astérix,,,,,,,,,,,,,,Not begun,,,2023-03-16,1',
  'a3,movie,Amélie,Jean-Pierre Jeunet,,,Salon,3333973137123,,,,,,,,,,,,,,,,,,,,,,2023-03-17,1',
  'a4,book,,,,,Salon,,,,,,,,,,,,,,,,,,,,,,,,1',
  'a5,book,Carnet sans code,Inconnu,,,Salon,,,,,,,,,,,,,,,,,,,,,,,,1',
].join('\n');

describe('exportation Libib', () => {
  it('est reconnue et convertie en notices et exemplaires', () => {
    const result = read(LIBIB);
    if (!result.ok) throw new Error(result.error);
    expect(result.format).toBe('libib');
    // The film and the row without title nor ISBN are left out.
    expect(result.ignoredRows).toBe(2);
    expect(result.books).toHaveLength(3);

    const [peste, asterix, carnet] = result.books;
    expect(peste?.fields).toEqual({
      isbn13: '9782070360420',
      isbn10: '2070360423',
      title: 'La Peste',
      authors: ['Albert Camus'],
      publisher: 'Gallimard',
      year: 1972,
      status: 'read',
      rating: 4,
      review: 'Magnifique',
      tags: ['classique', 'poche'],
    });
    expect(peste?.copies).toHaveLength(2);
    expect(peste?.copies[0]).toEqual({ addedAt: new Date(2023, 2, 15).getTime(), note: 'Dédicacé' });
    expect(peste?.copies[1]?.note).toBeUndefined();

    expect(asterix?.fields.authors).toEqual(['René Goscinny', 'Albert Uderzo']);
    expect(asterix?.fields.seriesName).toBe('Astérix');
    expect(asterix?.fields.status).toBe('toread');
    expect(carnet?.fields.isbn13).toBeUndefined();
  });

  it('accepte les noms de colonnes des exportations anciennes', () => {
    const result = read('authors,title,isbn13,isbn10,added_date,status\n"Camus, Albert",L’Étranger,,2070360024,03/15/2023,Completed\n');
    if (!result.ok) throw new Error(result.error);
    expect(result.books[0]?.fields).toMatchObject({ isbn13: '9782070360024', isbn10: '2070360024', status: 'read' });
    expect(result.books[0]?.copies[0]?.addedAt).toBe(new Date(2023, 2, 15).getTime());
  });

  it('réunit le prénom et le nom séparés par une virgule', () => {
    const result = read('title,creators,first_name,last_name\nL’Étranger,"Camus, Albert",Albert,Camus\n');
    if (!result.ok) throw new Error(result.error);
    expect(result.books[0]?.fields.authors).toEqual(['Albert Camus']);
  });

  it('retrouve un ISBN-10 dont Excel a retiré le zéro initial', () => {
    const result = read('title,upc_isbn10\nDesign Patterns,201633612\n');
    if (!result.ok) throw new Error(result.error);
    expect(result.books[0]?.fields.isbn13).toBe('9780201633610');
  });
});

describe('fichier de l’application', () => {
  it('réunit les lignes d’une même notice en plusieurs exemplaires', () => {
    const text = [
      'Titre;Auteurs;ISBN-13;Pièce;Étagère;Statut;Ajouté le;Remarque',
      'La Peste;Albert Camus;="9782070360420";Salon;Étagère 2;Lu;2026-11-01;',
      'La Peste;Albert Camus;9782070360420;Bureau;Haut;Lu;02/11/2026;Abîmé',
      'Carnet;;;Salon;;À lire;;',
      'Sans place;Anonyme;;;;;;',
    ].join('\r\n');
    const result = read(text);
    if (!result.ok) throw new Error(result.error);
    expect(result.format).toBe('app');
    expect(result.books).toHaveLength(3);
    expect(result.books[0]?.fields.status).toBe('read');
    expect(result.books[0]?.copies).toEqual([
      { room: 'Salon', shelf: 'Étagère 2', addedAt: new Date(2026, 10, 1).getTime() },
      { room: 'Bureau', shelf: 'Haut', addedAt: new Date(2026, 10, 2).getTime(), note: 'Abîmé' },
    ]);
    expect(result.books[1]?.copies).toEqual([{ room: 'Salon' }]);
    expect(result.books[2]?.copies).toEqual([{}]);
  });

  it('relit le prix d’achat, écrit à la française ou non', () => {
    const result = read(['Titre;Prix d’achat', 'La Peste;12,50', 'Noces;7.9 €', 'Carnet;gratuit'].join('\r\n'));
    if (!result.ok) throw new Error(result.error);
    expect(result.books.map((book) => book.fields.price)).toEqual([12.5, 7.9, undefined]);
    expect(parsePrice('1 234,5')).toBe(1234.5);
    expect(parsePrice('$12.99')).toBe(12.99);
    expect(parsePrice('')).toBeUndefined();
  });
});

describe('fichiers refusés', () => {
  it('signale un fichier vide ou d’une autre provenance', () => {
    expect(read('')).toEqual({ ok: false, error: 'empty' });
    expect(read('Titre;Auteurs\n')).toEqual({ ok: false, error: 'empty' });
    expect(read('Name,Author\nX,Y\n')).toEqual({ ok: false, error: 'unknownFormat' });
  });
});

describe('dates', () => {
  it('lisent le jour en premier dans un fichier français, le mois dans un fichier Libib', () => {
    expect(readDate('2026-11-01', 'dayFirst')).toBe(new Date(2026, 10, 1).getTime());
    expect(readDate('01/11/2026', 'dayFirst')).toBe(new Date(2026, 10, 1).getTime());
    expect(readDate('11/01/2026', 'monthFirst')).toBe(new Date(2026, 10, 1).getTime());
    // Only one reading possible.
    expect(readDate('25/11/2026', 'monthFirst')).toBe(new Date(2026, 10, 25).getTime());
    expect(readDate('11/25/2026', 'dayFirst')).toBe(new Date(2026, 10, 25).getTime());
    expect(readDate('31/02/2026', 'dayFirst')).toBeUndefined();
    expect(readDate('hier', 'dayFirst')).toBeUndefined();
  });
});
