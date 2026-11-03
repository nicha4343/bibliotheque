import { describe, expect, it } from 'vitest';
import type { Book } from '../db/schema';
import { parseBnf, volumeNumber } from '../metadata/sources';
import { newBook } from '../scan/session';
import { catalogOf, listedVolumes, matchingSets, recordCount, searchSeriesCatalog, setLinks } from './catalog';
import isbnXml from './fixtures/bnf-isbn.xml?raw';
import setXml from './fixtures/bnf-set.xml?raw';
import { catalogVolume, groupSeries, seriesKey } from './series';

// Answers of the BnF of 3 November 2026 (fields reduced to those read): two volumes of Pat’Apouf
// (Éditions du Triomphe) asked by their ISBN, then the records linked to the series record 40061692.

const book = (title: string, fields: Partial<Book> = {}): Book => newBook({ title, authors: ['Gervy'], ...fields });

describe('réponses de la BnF', () => {
  it('sont lues quel que soit l’écriture du format (« UNIMARC »)', () => {
    expect(parseBnf(isbnXml)).toMatchObject({ title: "Pat'Apouf et l'empreinte du tatoué", seriesName: "Pat'Apouf", seriesIndex: 17 });
  });

  it('lisent le numéro du tome sous toutes ses formes', () => {
    expect(volumeNumber('4')).toBe(4);
    expect(volumeNumber('G 11')).toBe(11);
    expect(volumeNumber('H13')).toBe(13);
    expect(volumeNumber('12 bis')).toBe(12);
    expect(volumeNumber('')).toBeUndefined();
  });
});

describe('catalogue d’une série à la BnF', () => {
  it('trouve la notice de la série des tomes possédés', () => {
    expect(setLinks(isbnXml).map((link) => [link.setId, link.setTitle])).toEqual([
      ['40061692', "Pat'Apouf"],
      ['40061692', "Pat'Apouf"],
    ]);
  });

  it('liste les tomes de la série, une édition par numéro, et en déduit le nombre de tomes parus', () => {
    expect(recordCount(setXml)).toBe(20);
    const catalog = catalogOf(listedVolumes(setXml), 1);
    expect(catalog.total).toBe(19);
    expect(catalog.volumes).toHaveLength(19);
    // Two records for volume 2: the 2006 edition, with an ISBN, wins over that of 1949.
    expect(catalog.volumes[1]).toEqual({ index: 2, title: "Pat'Apouf prend des vacances", isbn13: '9782843782909' });
    expect(catalog.volumes.find((volume) => volume.index === 14)).toEqual({ index: 14, title: "Pat'Apouf en fusée", isbn13: '9782843786129' });
  });

  it('retrouve par son nom une série dont aucun tome n’est connu de la BnF', () => {
    const links = [
      { setId: '1', setTitle: 'Les aventures de Sylvain et Sylvette', authors: ['Cuvillier'] },
      { setId: '2', setTitle: 'Sylvain et Sylvette', authors: ['Autre'] },
      { setId: '3', setTitle: 'Les aventures de Sylvain et Sylvette', authors: ['Inconnu'] },
    ];
    expect(matchingSets(links, { key: seriesKey('Sylvain et Sylvette'), authors: ['Maurice Cuvillier'] })).toEqual(['1', '2']);
  });

  it('interroge la BnF par les ISBN des tomes possédés, puis par la notice de la série', async () => {
    const asked: string[] = [];
    const fetchImpl = ((url: string) => {
      asked.push(decodeURIComponent(url));
      return Promise.resolve(new Response(url.includes('ens2bib') ? setXml : isbnXml));
    }) as typeof fetch;
    const [group] = groupSeries([book('Pat’Apouf en Amazonie', { seriesName: "Pat'Apouf", seriesIndex: 9, isbn13: '9782843784798' })]);
    if (!group) throw new Error('series expected');
    const catalog = await searchSeriesCatalog(group, fetchImpl, 5);
    expect(catalog).toMatchObject({ total: 19, checkedAt: 5, source: 'bnf' });
    expect(asked.map((url) => /query=([^&]*)/.exec(url)?.[1])).toEqual(['bib.isbn any "9782843784798"', 'bib.ens2bib all "40061692"']);
  });

  it('donne le nombre de tomes et le titre des tomes manquants, sauf nombre indiqué par l’utilisateur', () => {
    const catalog = catalogOf(listedVolumes(setXml), 1);
    const books = [book('Pat’Apouf en Amazonie', { seriesName: "Pat'Apouf", seriesIndex: 9 })];
    const [found] = groupSeries(books, [{ id: seriesKey("Pat'Apouf"), catalog }]);
    expect(found).toMatchObject({ total: 19, owned: 1 });
    expect(found?.missing).toHaveLength(18);
    expect(found && catalogVolume(found, 14)?.title).toBe("Pat'Apouf en fusée");
    const [declared] = groupSeries(books, [{ id: seriesKey("Pat'Apouf"), catalog, total: 20 }]);
    expect(declared?.total).toBe(20);
  });
});
