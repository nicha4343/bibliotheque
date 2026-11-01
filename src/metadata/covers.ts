import type { CoverProvider } from '../db/schema';
import { isbn13To10 } from '../isbn/isbn';
import { openLibraryCoverUrl } from './sources';

export interface CoverCandidate {
  provider: CoverProvider;
  url: string;
}

export interface FoundCover extends CoverCandidate {
  /** Downloaded image, kept in the database so that it shows offline. */
  blob?: Blob;
}

// Smaller images are placeholders (« image not available », Amazon's 1-pixel image), not covers.
const MIN_SIDE = 40;
const DISPLAY_TIMEOUT_MS = 8000;

/** Amazon cover by ISBN-10, so 978 ISBNs only. Readable from the application: stored, shown offline. */
export function amazonCoverUrl(isbn13: string): string | undefined {
  const isbn10 = isbn13To10(isbn13);
  return isbn10 ? `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01.LZZZZZZZ.jpg` : undefined;
}

/** Decitre cover by EAN (403 when there is none). Its host forbids reading it: kept as a link, shown online only. */
export function decitreCoverUrl(isbn13: string): string {
  return `https://products-images.di-static.com/image/_/${isbn13}-475x500-1.jpg`;
}

/**
 * Last resort, after the metadata sources: covers of booksellers, which have those of recent French
 * books (Éditions du Triomphe, 2026) when Open Library and Google Books have none. Unofficial
 * addresses, chosen by the user on 1 November 2026: they may stop working without notice.
 */
export function bookshopCandidates(isbn13: string): CoverCandidate[] {
  const amazon = amazonCoverUrl(isbn13);
  return [...(amazon ? [{ provider: 'amazon' as const, url: amazon }] : []), { provider: 'decitre', url: decitreCoverUrl(isbn13) }];
}

async function download(url: string): Promise<Blob | 'blocked' | undefined> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return undefined;
    const bitmap = await createImageBitmap(blob);
    const usable = bitmap.width >= MIN_SIDE && bitmap.height >= MIN_SIDE;
    bitmap.close();
    return usable ? blob : undefined;
  } catch {
    // Network error, or a host that forbids reading its images from another site.
    return navigator.onLine ? 'blocked' : undefined;
  }
}

/**
 * Whether an image that cannot be read still displays: its host may answer an error (Decitre
 * without the cover) that fetch cannot see, as the host forbids reading the answer.
 */
function displays(url: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const image = new Image();
    const done = (ok: boolean) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => {
      done(false);
    }, DISPLAY_TIMEOUT_MS);
    image.onload = () => {
      done(image.naturalWidth >= MIN_SIDE && image.naturalHeight >= MIN_SIDE);
    };
    image.onerror = () => {
      done(false);
    };
    image.src = url;
  });
}

/** One candidate: downloaded when allowed, kept as a link when its host forbids reading it. */
export async function fetchCover(candidate: CoverCandidate): Promise<FoundCover | undefined> {
  const result = await download(candidate.url);
  if (result instanceof Blob) return { ...candidate, blob: result };
  return result === 'blocked' && (await displays(candidate.url)) ? { ...candidate } : undefined;
}

/**
 * First cover that can be downloaded among the candidates, then Open Library by ISBN, then the
 * booksellers. A cover that may only be displayed (not downloaded) is kept as a link when nothing
 * better exists.
 */
export async function downloadCover(isbn13: string, candidates: readonly CoverCandidate[]): Promise<FoundCover | undefined> {
  const all = [...candidates];
  if (!all.some((candidate) => candidate.provider === 'openLibrary')) {
    all.push({ provider: 'openLibrary', url: openLibraryCoverUrl(isbn13) });
  }
  all.push(...bookshopCandidates(isbn13));
  let linkOnly: FoundCover | undefined;
  for (const candidate of all) {
    const result = await download(candidate.url);
    if (result instanceof Blob) return { ...candidate, blob: result };
    if (result === 'blocked' && !linkOnly && (await displays(candidate.url))) linkOnly = candidate;
  }
  return linkOnly;
}
