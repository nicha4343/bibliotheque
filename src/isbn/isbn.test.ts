import { describe, expect, it } from 'vitest';
import { cleanIsbn, isbn10To13, isbn13To10, isValidIsbn10, isValidIsbn13, toIsbn13 } from './isbn';

describe('ISBN', () => {
  it('nettoie les espaces et les tirets', () => {
    expect(cleanIsbn(' 978-2-07-036042-0 ')).toBe('9782070360420');
    expect(cleanIsbn('2-07-036042-x')).toBe('207036042X');
  });

  it('valide la clé des ISBN-13', () => {
    expect(isValidIsbn13('9782070360420')).toBe(true);
    expect(isValidIsbn13('9791090648217')).toBe(false);
    expect(isValidIsbn13('9782070360421')).toBe(false);
  });

  it('refuse les codes-barres qui ne sont pas des ISBN', () => {
    expect(isValidIsbn13('3017620422003')).toBe(false); // food product
    expect(isValidIsbn13('9790230000000')).toBe(false); // ISMN, printed music
    expect(isValidIsbn13('978207036042')).toBe(false);
  });

  it('valide la clé des ISBN-10, y compris X', () => {
    expect(isValidIsbn10('2070360423')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('2070360424')).toBe(false);
  });

  it('convertit entre ISBN-10 et ISBN-13', () => {
    expect(isbn10To13('2070360423')).toBe('9782070360420');
    expect(isbn13To10('9782070360420')).toBe('2070360423');
    expect(isbn13To10('9780804429573')).toBe('080442957X');
    expect(isbn13To10('9791032305690')).toBeUndefined();
  });

  it('ramène tout ISBN valide à l’ISBN-13', () => {
    expect(toIsbn13('2-07-036042-3')).toBe('9782070360420');
    expect(toIsbn13('978-2-07-036042-0')).toBe('9782070360420');
    expect(toIsbn13('9791032305690')).toBe('9791032305690');
    expect(toIsbn13('12345')).toBeUndefined();
  });
});
