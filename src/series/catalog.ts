import type { Book, SeriesCatalog, CatalogVolume } from '../db/schema';
import { toIsbn13 } from '../isbn/isbn';
import { unimarcRecords, unimarcValue, volumeNumber, type UnimarcField } from '../metadata/sources';
import { authorKey, seriesKey, type SeriesGroup } from './series';

// « Nombre de tomes parus » (screen 9), found at the BnF: each volume of a series is linked to the
// record of the whole series (zone 461, its number in $0), and the index ens2bib lists the records
// linked to it, with their volume number ($v), title and ISBN. The number of volumes is the highest
// number listed: the BnF may lack a volume in between, or the latest one for a few weeks.

const SRU = 'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&recordSchema=unimarcxchange';
const PAGE = 100;
const MAX_PAGES = 10;
/** Owned volumes whose ISBN is asked to the BnF to find the record of the series. */
const MAX_ISBNS = 8;

const sruUrl = (query: string, maximum: number, start = 1): string =>
  `${SRU}&query=${encodeURIComponent(query)}&maximumRecords=${maximum}&startRecord=${start}`;

export const recordsOfIsbnsUrl = (isbns: readonly string[]): string => sruUrl(`bib.isbn any "${isbns.join(' ')}"`, MAX_ISBNS * 2);
export const recordsOfTitleUrl = (title: string): string => sruUrl(`bib.title all "${title.replace(/"/g, ' ')}"`, 50);
export const volumesOfSetUrl = (setId: string, start = 1): string => sruUrl(`bib.ens2bib all "${setId}"`, PAGE, start);

/** A record linked to the record of a series. */
export interface SetLink {
  setId: string;
  setTitle: string;
  authors: string[];
}

function authorsOf(fields: readonly UnimarcField[]): string[] {
  return fields
    .filter((field) => field.tag === '700' || field.tag === '701')
    .map((field) => field.subfields.find((subfield) => subfield.code === 'a')?.value.trim() ?? '')
    .filter(Boolean);
}

/** The series records the answer's books belong to (461 $0 and $t). */
export function setLinks(xml: string): SetLink[] {
  return unimarcRecords(xml).flatMap((fields) => {
    const setId = unimarcValue(fields, '461', '0');
    const setTitle = unimarcValue(fields, '461', 't');
    return setId && setTitle ? [{ setId, setTitle, authors: authorsOf(fields) }] : [];
  });
}

/**
 * Series records that match a series of the library found by its name: same name, or a name that
 * contains it (« Les aventures de Sylvain et Sylvette ») when an author is the same (last name).
 */
export function matchingSets(links: readonly SetLink[], group: Pick<SeriesGroup, 'key' | 'authors'>): string[] {
  const lastNames = new Set(group.authors.map((author) => authorKey(author).split(' ').at(-1) ?? ''));
  return [
    ...new Set(
      links
        .filter((link) => {
          const key = seriesKey(link.setTitle);
          if (key === group.key) return true;
          return key.includes(group.key) && link.authors.some((author) => lastNames.has(authorKey(author)));
        })
        .map((link) => link.setId),
    ),
  ];
}

interface ListedVolume extends CatalogVolume {
  year: number;
}

/** Volumes listed by an ens2bib answer; per number, the most recent edition with an ISBN wins. */
export function listedVolumes(xml: string): ListedVolume[] {
  return unimarcRecords(xml).flatMap((fields) => {
    const index = volumeNumber(unimarcValue(fields, '461', 'v'));
    if (index === undefined) return [];
    const main = unimarcValue(fields, '200', 'a') ?? '';
    // « Mamba noir », part « Les aventures du colonel Mareuil - tome 5 »: the part title is in $i when $a names the series.
    const part = unimarcValue(fields, '200', 'i');
    const title = part && seriesKey(main) === seriesKey(unimarcValue(fields, '461', 't') ?? '') ? part : main;
    const isbn13 = toIsbn13(unimarcValue(fields, '010', 'a') ?? '');
    const date = unimarcValue(fields, '210', 'd') ?? unimarcValue(fields, '214', 'd') ?? '';
    const year = Number(/\b(1[5-9]\d\d|20\d\d)\b/.exec(date)?.[1] ?? 0);
    const volume: ListedVolume = { index, title, year };
    if (isbn13) volume.isbn13 = isbn13;
    return title ? [volume] : [];
  });
}

/** Number of records of the answer, to read the following pages. */
export const recordCount = (xml: string): number => Number(/<(?:\w+:)?numberOfRecords>(\d+)</.exec(xml)?.[1] ?? 0);

/** The catalogue of a series from the volumes listed: one entry per number, the highest number as total. */
export function catalogOf(volumes: readonly ListedVolume[], checkedAt: number): SeriesCatalog {
  const best = new Map<number, ListedVolume>();
  for (const volume of volumes) {
    const current = best.get(volume.index);
    const better =
      !current ||
      (volume.isbn13 !== undefined && current.isbn13 === undefined) ||
      ((volume.isbn13 === undefined) === (current.isbn13 === undefined) && volume.year > current.year);
    if (better) best.set(volume.index, volume);
  }
  const listed = [...best.values()].sort((a, b) => a.index - b.index).map(({ year: _year, ...volume }) => volume);
  return { total: Math.max(0, ...listed.map((volume) => volume.index)), volumes: listed, checkedAt, source: 'bnf' };
}

async function text(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`BnF answered ${response.status}`);
  return response.text();
}

/** Series records of a series of the library: through the ISBN of its volumes, else through its name. */
async function findSets(group: SeriesGroup, fetchImpl: typeof fetch): Promise<string[]> {
  const isbns = group.volumes.flatMap(({ book }: { book: Book }) => (book.isbn13 ? [book.isbn13] : [])).slice(0, MAX_ISBNS);
  if (isbns.length > 0) {
    const sets = [...new Set(setLinks(await text(recordsOfIsbnsUrl(isbns), fetchImpl)).map((link) => link.setId))];
    if (sets.length > 0) return sets;
  }
  return matchingSets(setLinks(await text(recordsOfTitleUrl(group.name), fetchImpl)), group);
}

/**
 * The BnF's catalogue of a series: total 0 when the BnF does not know it as a series. Rejects when the
 * BnF cannot be reached (searched again later).
 */
export async function searchSeriesCatalog(group: SeriesGroup, fetchImpl: typeof fetch = fetch.bind(globalThis), now = Date.now()): Promise<SeriesCatalog> {
  const volumes: ListedVolume[] = [];
  for (const setId of await findSets(group, fetchImpl)) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const xml = await text(volumesOfSetUrl(setId, page * PAGE + 1), fetchImpl);
      volumes.push(...listedVolumes(xml));
      if ((page + 1) * PAGE >= recordCount(xml)) break;
    }
  }
  return catalogOf(volumes, now);
}
