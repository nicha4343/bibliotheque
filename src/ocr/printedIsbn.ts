import { isValidIsbn10, isValidIsbn13, isbn10To13 } from '../isbn/isbn';
import { recognizeLines, type RecognizedImage } from './engine';

// ISBN printed without a barcode, on old books (lot 9): the line « ISBN 2-07-036002-4 » is
// photographed during the scan and read by Tesseract.js in the phone. The check digit sorts out the
// misreads: a number read wrong is almost never a valid ISBN.

/** Characters Tesseract takes for digits in a line of figures. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  i: '1',
  l: '1',
  '|': '1',
  '!': '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  G: '6',
  b: '6',
  T: '7',
  B: '8',
  g: '9',
  q: '9',
  x: 'X',
  '×': 'X',
};

/** « ISBN », « ISBN-13 : », or as Tesseract may read it: « lSBN », « I5BN », « ISBN: ». */
const LABEL = /[I1l|][S5$][B8]N(?:[\s-]*1[03])?\s*:?/gu;
const DASHES = /[‐‑‒–—―−]/gu;
/** An ISBN-10 printed with its hyphens: « 2-07-036002-4 ». */
const HYPHENATED_10 = /^\d{1,5}-\d{1,7}-\d{1,7}-[\dX]$/;
/** Words joined to form a number printed with spaces: « 978 2 07 036002 4 ». */
const MAX_WORDS = 6;

/** A word of the line as figures, or undefined when it holds letters that are not look-alikes. */
function figures(word: string): string | undefined {
  const mapped = Array.from(word.replace(/[.,;:()]+$/u, '').replace(/^[.,;:()]+/u, ''), (char) => LOOK_ALIKES[char] ?? char).join('');
  return /^[\dX-]+$/.test(mapped) && /\d/.test(mapped) ? mapped : undefined;
}

interface Candidate {
  isbn13: string;
  /** Read right after the word « ISBN ». */
  labelled: boolean;
  /** An ISBN-10 is trusted without its label only when printed with its hyphens. */
  trusted: boolean;
}

/** Valid ISBNs formed by one word of the line or by several following ones, in reading order. */
function candidatesOf(words: readonly string[], labelled: boolean): Candidate[] {
  const found: Candidate[] = [];
  for (let start = 0; start < words.length; start += 1) {
    let joined = '';
    for (let end = start; end < Math.min(words.length, start + MAX_WORDS); end += 1) {
      const part = figures(words[end] ?? '');
      if (part === undefined) break;
      joined += (joined ? ' ' : '') + part;
      const code = joined.replace(/[\s-]/g, '');
      if (code.length > 13) break;
      if (isValidIsbn13(code)) found.push({ isbn13: code, labelled, trusted: true });
      else if (isValidIsbn10(code)) found.push({ isbn13: isbn10To13(code), labelled, trusted: start === end && HYPHENATED_10.test(joined) });
    }
  }
  return found;
}

/**
 * The ISBN printed in the lines read, as ISBN-13: the number following the word « ISBN » first; else
 * an ISBN-13, or an ISBN-10 printed with its hyphens (a telephone number has ten figures too).
 */
export function findPrintedIsbn(lines: readonly string[]): string | undefined {
  const candidates: Candidate[] = [];
  lines.forEach((line, index) => {
    const text = line.replace(DASHES, '-');
    const labels = [...text.matchAll(LABEL)];
    if (labels.length === 0) {
      candidates.push(...candidatesOf(text.split(/\s+/).filter(Boolean), false));
      return;
    }
    for (const label of labels) {
      const after = text.slice(label.index + label[0].length).trim();
      // « ISBN » at the end of a line: the number is on the next one.
      const rest = after || (lines[index + 1] ?? '').replace(DASHES, '-');
      candidates.push(...candidatesOf(rest.split(/\s+/).filter(Boolean), true));
    }
  });
  return (candidates.find((candidate) => candidate.labelled) ?? candidates.find((candidate) => candidate.trusted))?.isbn13;
}

type Recognize = (photo: Blob, layout: 'block', smoothing: number) => Promise<RecognizedImage>;

/**
 * Smoothing of the second reading, in pixels: tried on photographs with heavy grain, it recovered the
 * figures, but it blurs small ones; so it comes only after a first reading without it.
 */
const SECOND_SMOOTHING = 1;

/** The ISBN read on a photograph of its line, undefined when none could be read. */
export async function readPrintedIsbn(photo: Blob, recognize: Recognize = recognizeLines): Promise<string | undefined> {
  for (const smoothing of [0, SECOND_SMOOTHING]) {
    const { lines } = await recognize(photo, 'block', smoothing);
    const isbn = findPrintedIsbn(lines.map((line) => line.text));
    if (isbn) return isbn;
  }
  return undefined;
}
