import { foldText } from '../library/filter';
import type { RecognizedImage, TextLine } from './engine';
import { FIRST_NAMES, PUBLISHERS, SURNAMES } from './names';

// Title, author and publisher suggested from the lines read on a cover (screens 3 and 4, lot 6).
// Tesseract reads covers approximately: stylized titles, pictures taken for letters. The lines it is
// unsure of are left out, the largest remaining text is taken for the title, a line starting with a
// first name or naming a known author for the author, a known name for the publisher. The user
// confirms or corrects every suggestion.

export interface CoverSuggestions {
  /** Most likely first; at most three of each. */
  titles: string[];
  authors: string[];
  publishers: string[];
}

/** Names already in the library: an author or publisher read on a cover is recognized by them. */
export interface KnownNames {
  authors: readonly string[];
  publishers: readonly string[];
}

const MAX_SUGGESTIONS = 3;

/** « L’ÉCOLE » → « l ecole »: comparisons ignore case, accents and punctuation. */
const wordKey = (text: string): string =>
  foldText(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const letterCount = (text: string): number => text.match(/\p{L}/gu)?.length ?? 0;
const isNumber = (text: string): boolean => /^\p{N}+$/u.test(text);
/** « 1984 »: a title may be a year. */
const isYear = (text: string): boolean => /^\p{N}{4}$/u.test(text);

/** « J.RR », « J.K. »: capitals and full stops only. */
const isInitials = (text: string): boolean => /^(?:\p{Lu}\.?){1,4}$/u.test(text) && text.includes('.');
/** « J.RR » → « J.R.R. ». */
const formatInitials = (text: string): string =>
  (text.match(/\p{Lu}/gu) ?? []).map((letter) => `${letter}.`).join('');

interface Word {
  text: string;
  confidence: number;
}

interface Line {
  words: Word[];
  text: string;
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** « (vu », « HERGÉ - », « DU, »: punctuation around a word is not part of it. */
const trimWord = (text: string): string =>
  text
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}.]+$/u, '')
    .replace(/(?<=\p{L}{2})\.$/u, '');

/**
 * The words Tesseract is sure enough of. A word it doubts is kept beside a word it is sure of
 * (« À L’ÉCOLE », « Lucrèce Borgia »): elisions and accents lower its confidence.
 */
function keptWords(line: TextLine): Word[] {
  const words = line.words
    .map((word) => ({ text: trimWord(word.text), confidence: word.confidence }))
    .filter((word) => word.text && /^[\p{L}\p{N}.'’-]+$/u.test(word.text))
    // « étranger Æ »: a letter alone is a piece of a picture, unless it is a word (« À l’école »).
    .filter((word) => word.text.length > 1 || !/\p{L}/u.test(word.text) || /^[aàyô]$/iu.test(word.text));
  const sure = words.some((word) => word.confidence >= 85 && letterCount(word.text) >= 1);
  const kept = words.filter((word) => word.confidence >= 60 || (sure && word.confidence >= 45 && letterCount(word.text) >= 3));
  // Figures alone are taken for pictures, except a year; beside words, they are a volume number.
  if (kept.every((word) => isNumber(word.text))) {
    const year = kept.length === 1 ? kept[0] : undefined;
    return year && isYear(year.text) && year.confidence >= 90 ? [year] : [];
  }
  return kept.filter((word) => !isNumber(word.text) || word.confidence >= 80);
}

function cleanLines(lines: readonly TextLine[]): Line[] {
  const result: Line[] = [];
  for (const line of lines) {
    const words = keptWords(line);
    if (words.length === 0) continue;
    const text = words.map((word) => word.text).join(' ');
    const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
    const letters = letterCount(text);
    // « vu », « Ji », « pèr »: a word of two or three letters alone is most often a piece of a picture.
    const initials = words.every((word) => isInitials(word.text));
    if (!initials && letters > 0 && (letters < 3 || (words.length === 1 && letters <= 3 && confidence < 80))) continue;
    result.push({ words, text, key: wordKey(text), top: line.top, left: line.left, width: line.width, height: line.height });
  }
  return result.sort((a, b) => a.top - b.top);
}

// Mentions that are neither the title nor the author: « Édition de Colette Becker », « Traduit de
// l’anglais par… », « Prix Goncourt », and a genre or a collection alone (« roman », « classiques »).
const EDITORIAL =
  /^(?:(?:nouvelle )?edition (?:de|etablie|presentee|revue|critique)|etablie par|preface|postface|traduit|traduction|illustrations?|illustre par|presentation|presente par|notes? de|dossier|lu par|adapte|adaptation|choix de|introduction|commentaires?|texte integral|prix )/;
const GENRE = /^(?:roman|recit|nouvelles?|poemes|poesie|theatre|essai|livre|classiques?|inedit|integrale?|best seller|collection)$/;

/** Lower case and particles of names: « de », « d’ », « von ». */
const PARTICLES = new Set(['de', 'du', 'des', 'd', 'von', 'van', 'der', 'den', 'di', 'da', 'del', 'della', 'y']);
/** Words a name never contains, but a title does: « Madame Bovary » is not an author. */
const NOT_IN_NAMES = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'sur', 'pour', 'dans', 'par', 'avec', 'sans', 'ou',
  'madame', 'monsieur', 'mademoiselle', 'the', 'of', 'and',
]);

interface NameIndex {
  firstNames: Map<string, string>;
  /** Full names of the library, by their folded form. */
  authors: Map<string, string>;
  /** Surnames alone: those of the list, and those of the library when only one author bears them. */
  surnames: Map<string, string>;
  publishers: { name: string; key: string }[];
}

function indexNames(known: KnownNames): NameIndex {
  const firstNames = new Map(FIRST_NAMES.map((name) => [wordKey(name), name]));
  const surnames = new Map(SURNAMES.map((name) => [wordKey(name), name]));
  const authors = new Map<string, string>();
  for (const name of known.authors) {
    const key = wordKey(name);
    if (key) authors.set(key, name);
  }
  const bySurname = new Map<string, string[]>();
  for (const [key, name] of authors) {
    const surname = key.split(' ').at(-1);
    if (surname && surname.length >= 3 && key.includes(' ')) bySurname.set(surname, [...(bySurname.get(surname) ?? []), name]);
  }
  for (const [surname, names] of bySurname) if (names.length === 1 && names[0]) surnames.set(surname, names[0]);

  const publishers = PUBLISHERS.flatMap(([name, ...keys]) => keys.map((key) => ({ name, key })));
  for (const name of known.publishers) {
    const key = wordKey(name).replace(/^(?:editions?|ed) (?:de |du |des |d )?/, '');
    if (key.length >= 3) publishers.push({ name, key });
  }
  // The longest first: « gallimard jeunesse » before « gallimard ».
  publishers.sort((a, b) => b.key.length - a.key.length);
  return { firstNames, authors, surnames, publishers };
}

// Words around a publisher's name on a cover: « Éditions du Triomphe », « Collection Folio ».
const PUBLISHER_FILLER = /\b(?:editions?|ed|collection|jeunesse|poche|les|le|la|l|du|de|des|d|aux|et)\b/g;

/** A line that names a publisher and little else (« Le Soleil des Scorta » is a title). */
function publisherOf(line: Line, names: NameIndex): string | undefined {
  const padded = ` ${line.key} `;
  for (const { name, key } of names.publishers) {
    if (!padded.includes(` ${key} `)) continue;
    if (letterCount(padded.replace(` ${key} `, ' ').replace(PUBLISHER_FILLER, ' ')) < 3) return name;
  }
  return undefined;
}

const isShouting = (text: string): boolean => {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && letters.filter((letter) => letter !== letter.toLocaleLowerCase('fr')).length >= letters.length * 0.6;
};

const capitalize = (word: string): string => word.charAt(0).toLocaleUpperCase('fr') + word.slice(1);

/** « SAINT-EXUPÉRY » → « Saint-Exupéry », « D’ORMESSON » → « d’Ormesson » (but first). */
export function nameCase(text: string): string {
  return text
    .split(' ')
    .map((word, index) => {
      if (isInitials(word)) return formatInitials(word);
      const lower = word.toLocaleLowerCase('fr');
      if (index > 0 && PARTICLES.has(lower)) return lower;
      return lower
        .split(/(?<=[-'’])/u)
        .map((part, partIndex) => (index > 0 && partIndex === 0 && /^d['’]$/u.test(part) ? part : capitalize(part)))
        .join('');
    })
    .join(' ');
}

/**
 * « LE SEIGNEUR DES ANNEAUX » → « Le Seigneur des anneaux »: French titles take a capital on their
 * first word, and on the next one after a definite article (« L’Étranger », « Le Lotus bleu »). A
 * title read in small letters keeps its capitals.
 */
export function titleCase(text: string): string {
  if (!isShouting(text)) return capitalize(text);
  const words = text.toLocaleLowerCase('fr').split(' ');
  return words
    .map((word, index) => {
      if (index === 0) {
        const elided = /^l(['’])(.+)$/iu.exec(word);
        return elided ? `L${elided[1] ?? ''}${capitalize(elided[2] ?? '')}` : capitalize(word);
      }
      return index === 1 && /^(?:le|la|les)$/iu.test(words[0] ?? '') ? capitalize(word) : word;
    })
    .join(' ');
}

/** Author's name read, as the library or the lists write it when they know it. */
function authorOf(line: Line, names: NameIndex): string | undefined {
  const known = names.authors.get(line.key);
  if (known) return known;
  const words = line.text.split(' ');
  if (words.length > 5 || line.key.split(' ').some((key) => NOT_IN_NAMES.has(key))) return undefined;
  // A name alone: a known surname, or a first name whose surname was not read (« Victor »).
  if (words.length === 1) return names.surnames.get(line.key) ?? names.firstNames.get(line.key);
  const first = words[0] ?? '';
  const firstName = names.firstNames.get(wordKey(first.split('-')[0] ?? ''));
  if (!isInitials(first) && !firstName) return undefined;
  // Every word of a name starts with a capital, but its particles.
  if (!words.every((word, index) => index === 0 || PARTICLES.has(word.toLocaleLowerCase('fr')) || /^\p{Lu}/u.test(word))) return undefined;
  const name = isShouting(line.text) ? nameCase(line.text) : words.map((word) => (isInitials(word) ? formatInitials(word) : word)).join(' ');
  // « Däniel Kox » → « Daniel Kox »: the first name as the list writes it.
  return firstName && !first.includes('-') ? [firstName, ...name.split(' ').slice(1)].join(' ') : name;
}

/** Lines of a title written on several lines: « LE SEIGNEUR » above « DES », of comparable size. */
function titleBlocks(lines: readonly Line[]): Line[][] {
  const blocks: Line[][] = [];
  for (const line of lines) {
    const block = blocks.at(-1);
    const previous = block?.at(-1);
    if (block && previous) {
      const gap = line.top - (previous.top + previous.height);
      const ratio = Math.min(line.height, previous.height) / Math.max(line.height, previous.height);
      const overlap = Math.min(line.left + line.width, previous.left + previous.width) - Math.max(line.left, previous.left);
      if (gap <= Math.max(line.height, previous.height) && gap > -previous.height / 2 && ratio >= 0.45 && overlap > 0) {
        block.push(line);
        continue;
      }
    }
    blocks.push([line]);
  }
  return blocks;
}

/** The largest text first; text Tesseract doubts counts for less, a doubtful word alone for less still. */
function titleScore(block: readonly Line[]): number {
  const words = block.flatMap((line) => line.words);
  const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
  const height = Math.max(...block.map((line) => line.height));
  const weight = Math.min(1, Math.max(0.05, ((confidence - 40) / 55) ** 2));
  const alone = words.length === 1 && confidence < 85 ? 0.6 : 1;
  return Math.sqrt(height) * weight * alone;
}

function pushUnique(list: string[], value: string): void {
  if (value && !list.some((item) => wordKey(item) === wordKey(value))) list.push(value);
}

export function readCover(image: RecognizedImage, known: KnownNames = { authors: [], publishers: [] }): CoverSuggestions {
  const names = indexNames(known);
  const lines = cleanLines(image.lines);
  const titles: string[] = [];
  const authors: string[] = [];
  const publishers: string[] = [];
  const rest: Line[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || EDITORIAL.test(line.key) || GENRE.test(line.key)) continue;
    const publisher = publisherOf(line, names);
    if (publisher) {
      pushUnique(publishers, publisher);
      continue;
    }
    // « J.RR » above « TOLKIEN »: initials alone belong to the name below.
    const next = lines[index + 1];
    if (next && line.words.every((word) => isInitials(word.text))) {
      const surname = authorOf(next, names) ?? (next.words.length === 1 && /^\p{Lu}/u.test(next.text) ? nameCase(next.text) : undefined);
      if (surname && !surname.includes(' ')) {
        pushUnique(authors, `${line.words.map((word) => formatInitials(word.text)).join(' ')} ${surname}`);
        index += 1;
        continue;
      }
    }
    const author = authorOf(line, names);
    if (author) pushUnique(authors, author);
    else rest.push(line);
  }

  // « DES » alone is no title, but belongs to « LE SEIGNEUR » above it.
  const blocks = titleBlocks(rest)
    .map((block) => ({ text: block.map((line) => line.text).join(' '), score: titleScore(block) }))
    .filter(({ text }) => letterCount(text) >= 4 || isYear(text))
    .sort((a, b) => b.score - a.score);
  for (const { text } of blocks) pushUnique(titles, titleCase(text));

  return {
    titles: titles.slice(0, MAX_SUGGESTIONS),
    authors: authors.slice(0, MAX_SUGGESTIONS),
    publishers: publishers.slice(0, MAX_SUGGESTIONS),
  };
}

/** Suggestions of two readings of the same cover, the first ones first. */
export function mergeSuggestions(first: CoverSuggestions, second: CoverSuggestions): CoverSuggestions {
  const merge = (a: readonly string[], b: readonly string[]) => {
    const list: string[] = [];
    for (const value of [...a, ...b]) pushUnique(list, value);
    return list.slice(0, MAX_SUGGESTIONS);
  };
  return {
    titles: merge(first.titles, second.titles),
    authors: merge(first.authors, second.authors),
    publishers: merge(first.publishers, second.publishers),
  };
}
