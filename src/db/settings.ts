import { db, type LibraryDatabase } from './db';
import { SETTINGS_KEY, type MetadataProvider, type Settings, type SettingsRecord } from './schema';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  scanSound: true,
  scanVibration: true,
  flagOwnedBooks: true,
  rememberShelfOrder: false,
  autoCovers: true,
  sources: { bnf: true, googleBooks: true, openLibrary: true },
  offlineScanning: true,
  googleBooksKey: '',
  loanNotifications: false,
  loanCalendar: false,
  wishListName: '',
  openRouterKey: '',
};

/**
 * Stored values over the defaults, so a setting added later gets its default value. Only the known
 * sources are kept: a source since removed (« Éditions du Triomphe », published on 9 November 2026 for
 * an hour) would otherwise be asked by every search, and fail.
 */
export function mergeSettings(stored: SettingsRecord | undefined): Settings {
  const { id: _id, sources, ...rest } = stored ?? { id: SETTINGS_KEY };
  const known = Object.fromEntries(
    (Object.keys(DEFAULT_SETTINGS.sources) as MetadataProvider[]).map((provider) => [
      provider,
      sources?.[provider] ?? DEFAULT_SETTINGS.sources[provider],
    ]),
  ) as Settings['sources'];
  return { ...DEFAULT_SETTINGS, ...rest, sources: known };
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
