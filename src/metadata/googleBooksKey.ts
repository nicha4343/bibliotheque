import { sourceUrl } from './sources';

export type KeyCheck = 'valid' | 'refused' | 'unverified';

// A well-known book, to check that Google Books answers with the key.
const SAMPLE_ISBN = '9782070360420';

/**
 * Asks Google Books once with the key. 400 and 403 mean a key that is wrong, restricted to other
 * sites or not allowed to use the Books API; anything else (network, quota) proves nothing.
 */
export async function checkGoogleBooksKey(key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<KeyCheck> {
  try {
    const response = await fetchImpl(sourceUrl('googleBooks', SAMPLE_ISBN, key), { signal: AbortSignal.timeout(8000) });
    if (response.ok) return 'valid';
    return response.status === 400 || response.status === 403 ? 'refused' : 'unverified';
  } catch {
    return 'unverified';
  }
}
