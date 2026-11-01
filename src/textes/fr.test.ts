import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, fr, plural } from './fr';

/** Every text of fr, functions being called with a few sample arguments. */
function collectTexts(node: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof node === 'string') {
    out.push({ path, text: node });
  } else if (typeof node === 'function') {
    const fn = node as (...args: unknown[]) => unknown;
    for (const sample of [0, 1, 2, 1234]) {
      collectTexts(fn(...Array.from({ length: fn.length }, () => sample)), `${path}(${sample})`, out);
    }
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectTexts(value, path ? `${path}.${key}` : key, out);
  }
}

const texts: { path: string; text: string }[] = [];
collectTexts(fr, '', texts);

// A letter on either side means the forbidden word is only part of a longer one.
const word = (pattern: string, flags = 'iu') => new RegExp(`(?<!\\p{L})(?:${pattern})(?!\\p{L})`, flags);

const RULES: { name: string; test: (text: string) => boolean }[] = [
  { name: 'apostrophe droite (employer ’)', test: (t) => t.includes("'") },
  { name: 'guillemets droits (employer « »)', test: (t) => t.includes('"') },
  { name: 'point d’exclamation', test: (t) => t.includes('!') },
  { name: 'espace ordinaire ou absente avant « : » (espace insécable)', test: (t) => /[^\u00a0]:/.test(t) },
  { name: 'espace ordinaire ou absente avant « ; » ou « ? » (espace fine insécable)', test: (t) => /[^\u202f\u00a0][;?]/.test(t) },
  { name: 'espace insécable manquante après «', test: (t) => /«[^\u00a0\u202f]/.test(t) },
  { name: 'espace insécable manquante avant »', test: (t) => /[^\u00a0\u202f]»/.test(t) },
  { name: 'trois points (employer …)', test: (t) => t.includes('...') },
  { name: 'espaces doubles ou en bordure', test: (t) => /\s{2}/.test(t) || t !== t.trim() },
  { name: 'tutoiement', test: (t) => word('tu|toi|te|ton|ta|tes|t’').test(t) },
  { name: '« on »', test: (t) => word('on').test(t) },
  { name: 'mois abrégé', test: (t) => word('(?:janv|févr|avr|juil|sept|oct|nov|déc)\\.').test(t) },
  { name: '« bouquin »', test: (t) => word('bouquins?').test(t) },
  { name: '« appli » (employer application)', test: (t) => word('applis?').test(t) },
  { name: '« démo » (employer démonstration)', test: (t) => word('démos?').test(t) },
  { name: '« photo » (employer photographie)', test: (t) => word('photos?').test(t) },
  { name: '« BD » (employer bandes dessinées)', test: (t) => word('BDs?', 'u').test(t) },
  { name: '« Réglages » (employer Paramètres)', test: (t) => word('réglages?').test(t) },
  { name: '« Envies » (employer Souhaits)', test: (t) => word('envies').test(t) },
  { name: '« Rendu » (employer Restitué)', test: (t) => word('rendus?|rendues?').test(t) },
  { name: '« Plus tard » ou « Passer » (employer Reporter)', test: (t) => word('plus tard').test(t) || t === 'Passer' },
  { name: '« ex. » (employer exemplaire)', test: (t) => word('ex\\.').test(t) },
];

describe('textes de l’interface', () => {
  it('sont tous collectés', () => {
    expect(texts.length).toBeGreaterThan(20);
  });

  for (const rule of RULES) {
    it(`ne contiennent pas : ${rule.name}`, () => {
      const offenders = texts.filter(({ text }) => rule.test(text)).map(({ path, text }) => `${path} → ${text}`);
      expect(offenders).toEqual([]);
    });
  }
});

describe('plural', () => {
  it('emploie le singulier pour 0 et 1', () => {
    expect(plural(0, 'livre', 'livres')).toBe('livre');
    expect(plural(1, 'livre', 'livres')).toBe('livre');
    expect(plural(2, 'livre', 'livres')).toBe('livres');
  });
});

describe('formatNumber', () => {
  it('sépare les milliers par une espace fine insécable', () => {
    expect(formatNumber(1234)).toBe('1\u202f234');
  });
});

describe('formatDate', () => {
  it('écrit « 1er » et le mois en entier', () => {
    expect(formatDate(new Date(2026, 10, 1))).toBe('1er novembre 2026');
    expect(formatDate(new Date(2027, 1, 2))).toBe('2 février 2027');
    expect(formatDate(new Date(2027, 7, 15))).toBe('15 août 2027');
  });
});

describe('textes calculés', () => {
  it('accordent les nombres', () => {
    expect(fr.library.summary(0)).toBe('Aucun livre pour le moment');
    expect(fr.library.summary(1)).toBe('1 livre');
    expect(fr.library.summary(3)).toBe('3 livres');
    expect(fr.nav.pendingBadge(2)).toBe('2 ouvrages en attente');
  });
});
