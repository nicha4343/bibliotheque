import { describe, expect, it } from 'vitest';
import { nameCase, readCover, titleCase, type CoverSuggestions } from './cover';
import type { RecognizedImage, TextLine } from './engine';
import fixtures from './fixtures/covers.json';

type FixtureLine = [words: [string, number][], left: number, top: number, width: number, height: number];

function image(isbn: string): RecognizedImage {
  const fixture = (fixtures as unknown as Record<string, { width: number; height: number; lines: FixtureLine[] }>)[isbn];
  if (!fixture) throw new Error(`No fixture ${isbn}`);
  return {
    width: fixture.width,
    height: fixture.height,
    lines: fixture.lines.map(([words, left, top, width, height]): TextLine => ({
      text: words.map(([text]) => text).join(' '),
      confidence: words.reduce((sum, [, confidence]) => sum + confidence, 0) / words.length,
      words: words.map(([text, confidence]) => ({ text, confidence })),
      left,
      top,
      width,
      height,
    })),
  };
}

/** A line read with the given confidence, one above the other. */
function lines(...texts: [text: string, height: number, confidence?: number][]): RecognizedImage {
  let top = 0;
  return {
    width: 1000,
    height: 1500,
    lines: texts.map(([text, height, confidence = 95]) => {
      const line: TextLine = {
        text,
        confidence,
        words: text.split(' ').map((word) => ({ text: word, confidence })),
        left: 100,
        top,
        width: 800,
        height,
      };
      top += height * 3;
      return line;
    }),
  };
}

describe('readCover on real readings', () => {
  // Covers read by Tesseract.js in the browser (src/ocr/fixtures/covers.json).
  const cases: [isbn: string, what: string, expected: Partial<CoverSuggestions>][] = [
    ['9782070360024', 'L’Étranger, Folio', { titles: ['Étranger'], authors: ['Albert Camus'], publishers: ['Folio'] }],
    ['9782266154116', 'Le Seigneur des anneaux 1, Pocket', { titles: ['Le Seigneur des', "La Communaute de l'anneau"], authors: ['J.R.R. Tolkien'] }],
    ['9782070584628', 'Harry Potter à l’école des sorciers', { titles: ["À l'école des sorciers", 'Hors'], authors: ['J.K. Rowling'] }],
    ['9782253004226', 'Germinal, Le Livre de Poche', { titles: ['Germinal'], authors: ['Zola'], publishers: [] }],
    ['9782203001046', 'Le Lotus bleu, Casterman', { titles: ['Le Lotus bleu', 'Les Aventures de tintin'], authors: ['Hergé'], publishers: ['Casterman'] }],
    ['9782800152851', 'Les Tuniques bleues, Dupuis', { authors: ['Daniel Kox', 'Raoul Cauvin'] }],
    ['9782290335222', 'Lucrèce Borgia, Librio', { titles: ['Lucrèce Borgia'], authors: ['Hugo'] }],
    ['9782843786129', 'Pat’Apouf, Éditions du Triomphe', { titles: [], authors: [], publishers: ['Éditions du Triomphe'] }],
    ['9782843786952', 'Pat’Apouf détective, Éditions du Triomphe', { publishers: ['Éditions du Triomphe'] }],
    ['9782253004868', 'Madame Bovary, Le Livre de Poche', { titles: ['Madame Bovary'], authors: ['Flaubert'] }],
    ['9782253096344', 'Les Misérables, Le Livre de Poche', { titles: ['Les Misérables'], authors: ['Victor Hugo'], publishers: [] }],
    ['9782070413119', 'Madame Bovary, Folio classique', { titles: ['Madame Bovary'], authors: ['Flaubert'], publishers: ['Folio'] }],
    ['9782253009689', 'Victor Hugo, Le Livre de Poche', { titles: [], authors: ['Victor'] }],
    ['9782070368228', '1984, Folio', { titles: ['1984'], authors: ['George Orwell'] }],
  ];

  it.each(cases)('%s (%s)', (isbn, _what, expected) => {
    expect(readCover(image(isbn))).toMatchObject(expected);
  });

  it('leaves out the lines Tesseract doubts and the editorial mentions', () => {
    const { titles, authors } = readCover(image('9782253096344'));
    expect([...titles, ...authors].join(' ')).not.toMatch(/Édition|classiques|meme|pour|Là/);
  });
});

describe('readCover', () => {
  it('recognizes the authors and publishers of the library', () => {
    const known = { authors: ['Jean-François Pays', 'Paul Dubois', 'Marie Dubois'], publishers: ['Éditions Pierre Téqui', 'Le Laurier'] };
    expect(readCover(lines(['PAYS', 60], ['Le grand voyage', 90], ['LE LAURIER', 30]), known)).toEqual({
      titles: ['Le grand voyage'],
      authors: ['Jean-François Pays'],
      publishers: ['Le Laurier'],
    });
    // Two authors of the library bear the name: it stays as read.
    expect(readCover(lines(['DUBOIS', 60]), known).authors).toEqual([]);
    expect(readCover(lines(['paul dubois', 40]), known).authors).toEqual(['Paul Dubois']);
  });

  it('tells a publisher from a title naming it', () => {
    expect(readCover(lines(['Le Soleil des Scorta', 90], ['ACTES SUD', 30]))).toMatchObject({
      titles: ['Le Soleil des Scorta'],
      publishers: ['Actes Sud'],
    });
    // A publisher bearing a first name is no author.
    expect(readCover(lines(['MICHEL LAFON', 30])).publishers).toEqual(['Michel Lafon']);
  });

  it('writes the names and titles read in capitals as they are usually written', () => {
    expect(readCover(lines(['ANTOINE DE SAINT-EXUPÉRY', 40], ['LE PETIT PRINCE', 90])).authors).toEqual(['Antoine de Saint-Exupéry']);
    expect(nameCase("JEAN D'ORMESSON")).toBe("Jean d'Ormesson");
    expect(titleCase('LE LoTuS BLEU')).toBe('Le Lotus bleu');
    expect(titleCase("L'ÉTRANGER")).toBe("L'Étranger");
    expect(titleCase('Lucrèce Borgia')).toBe('Lucrèce Borgia');
  });

  it('joins the initials read above a name', () => {
    expect(readCover(lines(['J.K.', 30], ['ROWLING', 40], ['HARRY POTTER', 120])).authors).toEqual(['J.K. Rowling']);
  });

  it('suggests nothing from an unreadable cover', () => {
    expect(readCover(lines(['ÿ ee', 60, 30], ['vu', 40, 70], ['S', 90, 90]))).toEqual({ titles: [], authors: [], publishers: [] });
  });
});
