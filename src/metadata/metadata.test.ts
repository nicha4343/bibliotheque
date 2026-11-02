import { describe, expect, it } from 'vitest';
import type { Book } from '../db/schema';
import bnfXml from './fixtures/bnf.xml?raw';
import googleBooksJson from './fixtures/googleBooks.json';
import openLibraryJson from './fixtures/openLibrary.json';
import { bookshopCandidates } from './covers';
import { completeBook, mergeRecords } from './merge';
import { SearchUnavailable, searchMetadata, setGoogleBooksPacing } from './search';
import { parseBnf, parseGoogleBooks, parseOpenLibrary, sourceUrl, type SourceRecord } from './sources';

const ISBN = '9782070360420';
const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

describe('analyse des sources', () => {
  it('lit une réponse de Google Books', () => {
    expect(parseGoogleBooks(googleBooksJson)).toEqual({
      provider: 'googleBooks',
      title: 'La peste',
      authors: ['Albert Camus'],
      publisher: 'Folio',
      year: 1972,
      language: 'fr',
      isbn10: '2070360423',
      coverUrl: 'https://books.google.com/books/content?id=Xq4pAAAAYAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
    });
  });

  it('lit une réponse d’Open Library', () => {
    expect(parseOpenLibrary(openLibraryJson)).toEqual({
      provider: 'openLibrary',
      title: 'La Peste',
      authors: ['Albert Camus'],
      publisher: 'Gallimard',
      year: 2022,
      coverUrl: 'https://covers.openlibrary.org/b/id/14831798-L.jpg',
    });
  });

  it('lit une notice UNIMARC de la BnF, sans les marques de tri ni les traducteurs', () => {
    expect(parseBnf(bnfXml)).toEqual({
      provider: 'bnf',
      title: 'La Peste',
      authors: ['Albert Camus'],
      publisher: 'Gallimard',
      year: 1972,
      language: 'fr',
      isbn10: '2070360423',
    });
  });

  it('ne retient rien d’une réponse vide', () => {
    expect(parseGoogleBooks({ kind: 'books#volumes', totalItems: 0 })).toBeUndefined();
    expect(parseOpenLibrary({})).toBeUndefined();
    expect(parseBnf('<srw:searchRetrieveResponse><srw:numberOfRecords>0</srw:numberOfRecords><srw:records/></srw:searchRetrieveResponse>')).toBeUndefined();
  });

  it('interroge la BnF avec l’ISBN-13 et l’ISBN-10', () => {
    expect(decodeURIComponent(sourceUrl('bnf', ISBN))).toContain('bib.isbn any "9782070360420 2070360423"');
  });

  it('ajoute la clé Google Books de l’utilisateur, s’il en a saisi une', () => {
    expect(sourceUrl('googleBooks', ISBN)).not.toContain('key=');
    expect(sourceUrl('googleBooks', ISBN, '  ')).not.toContain('key=');
    expect(sourceUrl('googleBooks', ISBN, ' AIza-test ')).toMatch(/&key=AIza-test$/);
  });
});

describe('fusion', () => {
  const google: SourceRecord = { provider: 'googleBooks', title: 'La peste', publisher: 'Folio', coverUrl: 'g.jpg' };
  const bnf: SourceRecord = { provider: 'bnf', title: 'La Peste', authors: ['Albert Camus'], year: 1972 };
  const openLibrary: SourceRecord = { provider: 'openLibrary', title: 'Peste', coverUrl: 'o.jpg' };

  it('donne la priorité à la première réponse et complète les champs vides', () => {
    expect(mergeRecords(ISBN, [google, bnf])).toEqual({
      isbn13: ISBN,
      title: 'La peste',
      authors: ['Albert Camus'],
      publisher: 'Folio',
      year: 1972,
      coverUrls: [{ provider: 'googleBooks', url: 'g.jpg' }],
      providers: ['googleBooks', 'bnf'],
    });
  });

  it('propose les couvertures d’Open Library en premier', () => {
    expect(mergeRecords(ISBN, [google, openLibrary]).coverUrls).toEqual([
      { provider: 'openLibrary', url: 'o.jpg' },
      { provider: 'googleBooks', url: 'g.jpg' },
    ]);
  });

  it('ne complète une notice existante que dans ses champs vides', () => {
    const book: Book = {
      id: 'b',
      isbn13: ISBN,
      title: 'La Peste (titre corrigé)',
      authors: [],
      status: 'toread',
      rating: 0,
      review: '',
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(completeBook(book, mergeRecords(ISBN, [bnf]))).toEqual({ authors: ['Albert Camus'], year: 1972 });
    expect(completeBook({ ...book, authors: ['A. Camus'], year: 1947 }, mergeRecords(ISBN, [bnf]))).toBeUndefined();
  });
});

describe('recherche simultanée', () => {
  const responses: Record<string, () => Response> = {
    googleapis: () => new Response(JSON.stringify(googleBooksJson)),
    openlibrary: () => new Response(JSON.stringify(openLibraryJson)),
    bnf: () => new Response(bnfXml),
  };
  const fakeFetch =
    (answer: (host: string) => Response | Promise<Response>): typeof fetch =>
    (input) => {
      const url = urlOf(input);
      const host = Object.keys(responses).find((key) => url.includes(key)) ?? '';
      return Promise.resolve(answer(host));
    };
  const allSources = { bnf: true, googleBooks: true, openLibrary: true };

  it('fusionne les réponses de toutes les sources', async () => {
    const progress: string[][] = [];
    const metadata = await searchMetadata(ISBN, {
      sources: allSources,
      fetchImpl: fakeFetch((host) => responses[host]?.() ?? new Response('', { status: 404 })),
      onProgress: (partial) => progress.push(partial.providers),
    });
    expect(metadata.providers.sort()).toEqual(['bnf', 'googleBooks', 'openLibrary']);
    expect(metadata.incomplete).toBeUndefined();
    expect(progress.length).toBe(3);
    expect(progress[0]?.length).toBe(1);
  });

  it('n’interroge que les sources activées', async () => {
    const asked: string[] = [];
    await searchMetadata(ISBN, {
      sources: { bnf: true, googleBooks: false, openLibrary: false },
      fetchImpl: (input) => {
        asked.push(urlOf(input));
        return Promise.resolve(new Response(bnfXml));
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('catalogue.bnf.fr');
  });

  it('signale un ISBN inconnu partout', async () => {
    const metadata = await searchMetadata(ISBN, {
      sources: allSources,
      fetchImpl: fakeFetch((host) => (host === 'bnf' ? new Response('<x/>') : new Response('{}'))),
    });
    expect(metadata.providers).toEqual([]);
  });

  it('distingue l’absence de réseau d’un ISBN inconnu', async () => {
    await expect(
      searchMetadata(ISBN, { sources: allSources, fetchImpl: () => Promise.reject(new TypeError('offline')) }),
    ).rejects.toBeInstanceOf(SearchUnavailable);
  });

  it('abandonne une source trop lente', async () => {
    const metadata = await searchMetadata(ISBN, {
      sources: allSources,
      timeoutMs: 50,
      fetchImpl: (input, init) => {
        if (urlOf(input).includes('bnf')) return Promise.resolve(new Response(bnfXml));
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    });
    expect(metadata.providers).toEqual(['bnf']);
    expect(metadata.incomplete).toBe(true);
  });

  it('signale une recherche incomplète quand une source refuse de répondre (quota de Google Books)', async () => {
    const metadata = await searchMetadata(ISBN, {
      sources: allSources,
      fetchImpl: fakeFetch((host) => (host === 'googleapis' ? new Response('{}', { status: 429 }) : new Response('{}'))),
    });
    expect(metadata.providers).toEqual([]);
    expect(metadata.incomplete).toBe(true);
  });

  it('demande de nouveau à Google Books après un refus momentané', async () => {
    let calls = 0;
    const metadata = await searchMetadata(ISBN, {
      sources: allSources,
      fetchImpl: fakeFetch((host) => {
        if (host !== 'googleapis') return new Response(host === 'bnf' ? '<x/>' : '{}');
        calls += 1;
        return calls < 3 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify(googleBooksJson));
      }),
    });
    expect(calls).toBe(3);
    expect(metadata.providers).toEqual(['googleBooks']);
    expect(metadata.incomplete).toBeUndefined();
  });

  it('ne redemande pas avec une clé refusée', async () => {
    let calls = 0;
    const metadata = await searchMetadata(ISBN, {
      sources: allSources,
      fetchImpl: fakeFetch((host) => {
        if (host !== 'googleapis') return new Response('{}');
        calls += 1;
        return new Response('{}', { status: 403 });
      }),
    });
    expect(calls).toBe(1);
    expect(metadata.incomplete).toBe(true);
  });

  it('espace les requêtes adressées à Google Books, même simultanées', async () => {
    setGoogleBooksPacing({ spacingMs: 40, retryDelaysMs: [] });
    try {
      const times: number[] = [];
      const options = {
        sources: { bnf: false, googleBooks: true, openLibrary: false },
        fetchImpl: fakeFetch(() => {
          times.push(Date.now());
          return new Response('{}');
        }),
      };
      await Promise.all([searchMetadata(ISBN, options), searchMetadata(ISBN, options)]);
      expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(30);
    } finally {
      setGoogleBooksPacing({ spacingMs: 0, retryDelaysMs: [0, 0] });
    }
  });
});

describe('couvertures des libraires', () => {
  it('cherchent chez Amazon par ISBN-10, puis chez Decitre par EAN', () => {
    expect(bookshopCandidates('9782383861089')).toEqual([
      { provider: 'amazon', url: 'https://images-na.ssl-images-amazon.com/images/P/2383861081.01.LZZZZZZZ.jpg' },
      { provider: 'decitre', url: 'https://products-images.di-static.com/image/_/9782383861089-475x500-1.jpg' },
    ]);
  });

  it('se limitent à Decitre pour un ISBN en 979, sans équivalent à dix chiffres', () => {
    expect(bookshopCandidates('9791023456783').map((candidate) => candidate.provider)).toEqual(['decitre']);
  });
});
