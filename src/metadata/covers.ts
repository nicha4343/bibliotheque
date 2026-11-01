import type { MetadataProvider } from '../db/schema';
import { openLibraryCoverUrl } from './sources';

export interface FoundCover {
  provider: MetadataProvider;
  url: string;
  /** Downloaded image, kept in the database so that it shows offline. */
  blob?: Blob;
}

// Smaller images are placeholders (« image not available »), not covers.
const MIN_SIDE = 40;

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
 * First cover that can be downloaded among the candidates, Open Library by ISBN last. A cover
 * that may only be displayed (not downloaded) is kept as a link when nothing better exists.
 */
export async function downloadCover(
  isbn13: string,
  candidates: readonly { provider: MetadataProvider; url: string }[],
): Promise<FoundCover | undefined> {
  const all = [...candidates];
  if (!all.some((candidate) => candidate.provider === 'openLibrary')) {
    all.push({ provider: 'openLibrary', url: openLibraryCoverUrl(isbn13) });
  }
  let linkOnly: FoundCover | undefined;
  for (const candidate of all) {
    const result = await download(candidate.url);
    if (result instanceof Blob) return { ...candidate, blob: result };
    if (result === 'blocked') linkOnly ??= candidate;
  }
  return linkOnly;
}
