// ISBN rules (docs/SPEC.md, « Règles transverses »): accept EAN-13 starting with 978 or 979 and
// ISBN-10, check the check digit, store everything as ISBN-13.

/** Removes spaces (\s includes no-break spaces) and hyphens; keeps digits and a final X. */
export function cleanIsbn(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

function digitsOf(code: string): number[] {
  return Array.from(code, (char) => (char === 'X' ? 10 : Number(char)));
}

export function isValidIsbn13(code: string): boolean {
  // 979-0 is the ISMN range (printed music), not books.
  if (!/^97(8|9)\d{10}$/.test(code) || code.startsWith('9790')) return false;
  const sum = digitsOf(code).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

export function isValidIsbn10(code: string): boolean {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  const sum = digitsOf(code).reduce((total, digit, index) => total + digit * (10 - index), 0);
  return sum % 11 === 0;
}

function isbn13CheckDigit(first12: string): string {
  const sum = digitsOf(first12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

export function isbn10To13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return first12 + isbn13CheckDigit(first12);
}

/** Only 978 ISBNs have an ISBN-10 equivalent. */
export function isbn13To10(isbn13: string): string | undefined {
  if (!isbn13.startsWith('978')) return undefined;
  const first9 = isbn13.slice(3, 12);
  const sum = digitsOf(first9).reduce((total, digit, index) => total + digit * (10 - index), 0);
  const check = (11 - (sum % 11)) % 11;
  return first9 + (check === 10 ? 'X' : String(check));
}

/** Any valid ISBN (10 or 13, with or without hyphens) as ISBN-13; undefined otherwise. */
export function toIsbn13(input: string): string | undefined {
  const code = cleanIsbn(input);
  if (isValidIsbn13(code)) return code;
  if (isValidIsbn10(code)) return isbn10To13(code);
  return undefined;
}
