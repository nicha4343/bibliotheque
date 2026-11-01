import { db, type LibraryDatabase } from './db';
import { SETTINGS_KEY, type Settings, type SettingsRecord } from './schema';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  scanSound: true,
  scanVibration: true,
  flagOwnedBooks: true,
  rememberShelfOrder: false,
  autoCovers: true,
  sources: { bnf: true, googleBooks: true, openLibrary: true },
  offlineScanning: true,
  googleBooksKey: '',
};

/** Stored values over the defaults, so a setting added later gets its default value. */
export function mergeSettings(stored: SettingsRecord | undefined): Settings {
  const { id: _id, sources, ...rest } = stored ?? { id: SETTINGS_KEY };
  return { ...DEFAULT_SETTINGS, ...rest, sources: { ...DEFAULT_SETTINGS.sources, ...sources } };
}

export async function getSettings(database: LibraryDatabase = db): Promise<Settings> {
  return mergeSettings(await database.settings.get(SETTINGS_KEY));
}

export async function updateSettings(
  changes: Partial<Omit<Settings, 'sources'>> & { sources?: Partial<Settings['sources']> },
  database: LibraryDatabase = db,
): Promise<Settings> {
  return database.transaction('rw', database.settings, async () => {
    const current = await getSettings(database);
    const next: Settings = { ...current, ...changes, sources: { ...current.sources, ...changes.sources } };
    await database.settings.put({ id: SETTINGS_KEY, ...next });
    return next;
  });
}
