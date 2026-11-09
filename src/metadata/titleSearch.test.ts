import { describe, expect, it } from 'vitest';
import googleBooks from './fixtures/googleBooks.json';
import bnf from './fixtures/search/bnf.xml?raw';
import openLibrary from './fixtures/search/openLibrary.json';
import {
  bnfSearchUrl,
  catalogWords,
  mergeEditions,
  parseBnfResults,
  parseGoogleBooksResults,
  parseOpenLibraryResults,
  searchEditions,
  type FoundEdition,
} from './titleSearch';

// Real answers to « lotus bleu hergé » (BnF, Open Library), 3 November 2026; Google Books answers a
// search as it answers an ISBN (src/metadata/fixtures/googleBooks.json).

const found = (title: string, extra: Partial<FoundEdition> = {}): FoundEdition => ({ provider: 'bnf', title, authors: ['Hergé'], ...extra });

describe('recherche par le titre et l’auteur', () => {
  it('ne demande à la BnF que les mots utiles, sans accents', () => {
    expect(catalogWords('Le Lotus bleu de Hergé')).toBe('lotus bleu herge');
    expect(decodeURIComponent(bnfSearchUrl('Le Lotus bleu de Hergé'))).toContain('bib.anywhere all "lotus bleu herge"');
  });

  it('lit les éditions trouvées par la BnF', () => {
    const editions = parseBnfResults(bnf);
    expect(editions).toHaveLength(10);
    expect(editions[2]).toMatchObject({ title: 'Le Lotus bleu', authors: ['Hergé'], publisher: 'Casterman', year: 1985, isbn13: '9782203011052' });
  });

  it('lit les œuvres trouvées par Open Library, avec leur édition française', () => {
    const [first] = parseOpenLibraryResults(openLibrary);
    expect(first).toMatchObject({ provider: 'openLibrary', title: 'Le lotus bleu', authors: ['Hergé'], publisher: 'Vingtième Siècle', year: 1934, language: 'fr' });
  });

  it('lit les volumes trouvés par Google Books', () => {
    expect(parseGoogleBooksResults(googleBooks)[0]).toMatchObject({ provider: 'googleBooks', title: 'La peste', authors: ['Albert Camus'] });
  });

  it('alterne les sources, place les éditions françaises en tête et écarte les doublons', () => {
    const editions = mergeEditions([
      [found('Le Lotus bleu', { provider: 'googleBooks', publisher: 'Casterman' }), found('Tintin au Tibet', { provider: 'googleBooks' })],
      [found('Al Lotuz glas', { language: 'br' }), found('Le lotus bleu', { publisher: 'Casterman', year: 2007 }), found('Le Lotus bleu', { publisher: 'Moulinsart' })],
    ]);
    expect(editions.map((edition) => `${edition.title} ${edition.publisher ?? ''}`.trim())).toEqual([
      'Le Lotus bleu Casterman',
      'Tintin au Tibet',
      'Le Lotus bleu Moulinsart',
      'Al Lotuz glas',
    ]);
  });

  it('place en tête les éditions dont le titre et l’auteur répondent aux mots recherchés', () => {
    const editions = mergeEditions(
      [[found('Les aventures de Tintin et Milou en noir et blanc'), found('Le Lotus bleu décrypté', { authors: ['Patrick Mérand'] }), found('Le Lotus bleu')]],
      'le lotus bleu Hergé',
    );
    expect(editions.map((edition) => edition.title)).toEqual(['Le Lotus bleu', 'Le Lotus bleu décrypté', 'Les aventures de Tintin et Milou en noir et blanc']);
  });

  it('interroge les sources actives et signale qu’aucune n’a pu être jointe', async () => {
    const asked: string[] = [];
    const answer = await searchEditions('lotus bleu hergé', {
      sources: { bnf: true, googleBooks: false, openLibrary: true, triomphe: false },
      fetchImpl: (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        asked.push(new URL(url).hostname);
        return Promise.resolve(url.includes('bnf') ? new Response(bnf) : Response.json(openLibrary));
      },
    });
    expect(asked.sort()).toEqual(['catalogue.bnf.fr', 'openlibrary.org']);
    expect(answer.unavailable).toBe(false);
    // The collection of albums found by the BnF first comes after « Le Lotus bleu ».
    expect(answer.editions[0]?.title).toMatch(/^le lotus bleu$/i);
    expect(answer.editions.at(-1)?.title).not.toMatch(/^Le Lotus bleu$/i);

    const offline = await searchEditions('lotus bleu', {
      sources: { bnf: true, googleBooks: false, openLibrary: true, triomphe: false },
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(offline).toEqual({ editions: [], unavailable: true });
  });
});
