export type StorageProtection = 'persistent' | 'bestEffort' | 'unknown';

/**
 * Asks the browser not to evict the library when space runs low (Safari otherwise may
 * clear the data of a site left unvisited). Granted more readily to installed apps.
 */
export async function requestPersistentStorage(): Promise<StorageProtection> {
  if (!('storage' in navigator) || typeof navigator.storage.persist !== 'function') return 'unknown';
  try {
    if (await navigator.storage.persisted()) return 'persistent';
    return (await navigator.storage.persist()) ? 'persistent' : 'bestEffort';
  } catch {
    return 'unknown';
  }
}

/** Current protection, without asking the browser for anything. */
export async function getStorageProtection(): Promise<StorageProtection> {
  if (!('storage' in navigator) || typeof navigator.storage.persisted !== 'function') return 'unknown';
  try {
    return (await navigator.storage.persisted()) ? 'persistent' : 'bestEffort';
  } catch {
    return 'unknown';
  }
}
