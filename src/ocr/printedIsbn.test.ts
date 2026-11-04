import { describe, expect, it } from 'vitest';
import type { RecognizedImage } from './engine';
import { findPrintedIsbn, readPrintedIsbn } from './printedIsbn';

describe('ISBN imprimé', () => {
  it('lit l’ISBN qui suit le mot « ISBN », ISBN-10 converti en ISBN-13', () => {
    expect(findPrintedIsbn(['ISBN 2-07-036002-4'])).toBe('9782070360024');
    expect(findPrintedIsbn(['ISBN 2-07-036822-X'])).toBe('9782070368228');
    expect(findPrintedIsbn(['ISBN-13 : 978-2-07-036002-4'])).toBe('9782070360024');
    expect(findPrintedIsbn(['ISBN: 2253004227'])).toBe('9782253004226');
  });

  it('lit un numéro imprimé avec des espaces', () => {
    expect(findPrintedIsbn(['ISBN 2 07 036002 4'])).toBe('9782070360024');
    expect(findPrintedIsbn(['978 2 07 036002 4'])).toBe('9782070360024');
  });

  it('corrige les confusions de lecture courantes et les tirets typographiques', () => {
    expect(findPrintedIsbn(['lSBN 2-O7-O36OO2-4'])).toBe('9782070360024');
    expect(findPrintedIsbn(['I5BN 2–07–036822–x'])).toBe('9782070368228');
    expect(findPrintedIsbn(['ISBN 2-07-036002-4.'])).toBe('9782070360024');
  });

  it('trouve la ligne de l’ISBN parmi les autres, ou le numéro à la ligne suivante', () => {
    expect(findPrintedIsbn(['Dépôt légal : mars 1972', 'N° d’édition : 15834', 'ISBN 2-07-036002-4', 'Imprimé en France'])).toBe(
      '9782070360024',
    );
    expect(findPrintedIsbn(['Gallimard, 1972. ISBN', '2-07-036002-4'])).toBe('9782070360024');
  });

  it('refuse un numéro dont la clé est fausse', () => {
    expect(findPrintedIsbn(['ISBN 2-07-036002-5'])).toBeUndefined();
    expect(findPrintedIsbn(['ISBN 978-2-07-036002-5'])).toBeUndefined();
  });

  it('lit un ISBN-10 dont seule la clé est séparée, ou écrit « I.S.B.N. »', () => {
    // Reported by the user on 4 November 2026: « 280065838-X », not recognized.
    expect(findPrintedIsbn(['280065838-X'])).toBe('9782800658384');
    expect(findPrintedIsbn(['Imprimé en Belgique 280065838-X'])).toBe('9782800658384');
    expect(findPrintedIsbn(['280065838- X'])).toBe('9782800658384');
    expect(findPrintedIsbn(['280065838-K'])).toBe('9782800658384');
    expect(findPrintedIsbn(['280065838X'])).toBe('9782800658384');
    expect(findPrintedIsbn(['I.S.B.N. 2-8006-5838-X'])).toBe('9782800658384');
    expect(findPrintedIsbn(['I. S. B. N. 280065838-X'])).toBe('9782800658384');
    expect(findPrintedIsbn(['ISBN 280065838-X'])).toBe('9782800658384');
  });

  it('ne prend pas un autre numéro de dix chiffres pour un ISBN', () => {
    // 0123456789 has a valid ISBN-10 check digit.
    expect(findPrintedIsbn(['Tél. 01 23 45 67 89'])).toBeUndefined();
    expect(findPrintedIsbn(['0123456789'])).toBeUndefined();
    expect(findPrintedIsbn(['01-23-45-67-89'])).toBeUndefined();
    expect(findPrintedIsbn(['01.23.45.67.89'])).toBeUndefined();
    expect(findPrintedIsbn(['Tél. 01 23 45 67 89', 'ISBN 2-07-036002-4'])).toBe('9782070360024');
    // Hyphenated as an ISBN, or an ISBN-13: trusted without the word « ISBN ».
    expect(findPrintedIsbn(['2-07-036002-4'])).toBe('9782070360024');
    expect(findPrintedIsbn(['EAN 9782070360024'])).toBe('9782070360024');
  });

  it('ne trouve rien dans un texte sans ISBN', () => {
    expect(findPrintedIsbn([])).toBeUndefined();
    expect(findPrintedIsbn(['Achevé d’imprimer le 12 mars 1972', 'sur les presses de Bussière'])).toBeUndefined();
  });

  const image = (texts: string[]): RecognizedImage => ({
    lines: texts.map((text) => ({ text, confidence: 80, words: [], left: 0, top: 0, width: 10, height: 10 })),
    width: 100,
    height: 20,
  });

  it('lit la photographie comme un bloc de quelques lignes, sans lissage d’abord', async () => {
    const calls: string[] = [];
    const isbn = await readPrintedIsbn(new Blob(), (_photo, layout, smoothing) => {
      calls.push(`${layout} ${smoothing}`);
      return Promise.resolve(image(['ISBN 2-07-036002-4']));
    });
    expect(isbn).toBe('9782070360024');
    expect(calls).toEqual(['block 0']);
  });

  it('relit la photographie lissée quand la première lecture n’a rien donné', async () => {
    const calls: number[] = [];
    const read = (texts: string[][]) => (_photo: Blob, _layout: 'block', smoothing: number) => {
      calls.push(smoothing);
      return Promise.resolve(image(texts[calls.length - 1] ?? []));
    };
    expect(await readPrintedIsbn(new Blob(), read([['ISEN Z-O7-...'], ['ISBN 2-07-036002-4']]))).toBe('9782070360024');
    expect(calls).toEqual([0, 1]);
    calls.length = 0;
    expect(await readPrintedIsbn(new Blob(), read([['...'], ['...']]))).toBeUndefined();
    expect(calls).toEqual([0, 1]);
  });
});
