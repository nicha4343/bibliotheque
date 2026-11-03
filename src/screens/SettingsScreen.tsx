import { useEffect, useState } from 'preact/hooks';
import { getBackupState } from '../backup/google';
import { EnrichmentStatus } from '../components/EnrichmentStatus';
import { ChevronRightIcon, DownloadIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { SwitchRow } from '../components/SwitchRow';
import { booksWithoutCover, enrichBooks, useEnrichment } from '../csv/enrich';
import { downloadText, exportLibrary, isoDate } from '../csv/export';
import type { BackupState, MetadataProvider, Settings } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../db/settings';
import { getStorageProtection, type StorageProtection } from '../db/storage';
import { useLiveQuery } from '../db/useLiveQuery';
import { disableLoanNotifications, enableLoanNotifications } from '../loans/reminders';
import { checkMistralKey } from '../metadata/mistral';
import { checkGoogleBooksKey } from '../metadata/googleBooksKey';
import { retryAllUnknown } from '../pending/pending';
import { LIST_TABS, routeHref } from '../router';
import { formatDate, formatDateTime, fr } from '../textes/fr';

type OfflineStatus = 'ready' | 'preparing' | 'unsupported';

const OFFLINE_TEXTS: Record<OfflineStatus, string> = {
  ready: fr.settings.offlineReady,
  preparing: fr.settings.offlinePreparing,
  unsupported: fr.settings.offlineUnsupported,
};

const STORAGE_TEXTS: Record<StorageProtection, string> = {
  persistent: fr.settings.storagePersistent,
  bestEffort: fr.settings.storageBestEffort,
  unknown: fr.settings.storageUnknown,
};

function useOfflineStatus(): OfflineStatus {
  const supported = 'serviceWorker' in navigator;
  const [status, setStatus] = useState<OfflineStatus>(supported ? 'preparing' : 'unsupported');
  useEffect(() => {
    if (!supported) return;
    let active = true;
    // Resolves once the service worker is active, i.e. every file is cached.
    void navigator.serviceWorker.ready.then(() => {
      if (active) setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [supported]);
  return status;
}

function useStorageProtection(): StorageProtection {
  const [protection, setProtection] = useState<StorageProtection>('unknown');
  useEffect(() => {
    let active = true;
    void getStorageProtection().then((value) => {
      if (active) setProtection(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return protection;
}

const SOURCES: { provider: MetadataProvider; detail: string }[] = [
  { provider: 'bnf', detail: fr.settings.bnfDetail },
  { provider: 'googleBooks', detail: fr.settings.googleBooksDetail },
  { provider: 'openLibrary', detail: fr.settings.openLibraryDetail },
];

const KEY_CHECKS = { valid: fr.settings.keyValid, refused: fr.settings.keyRefused, unverified: fr.settings.keyUnverified };

/** « Clé Google Books »: checked once when saved, then the unknown ISBNs are searched again. */
function GoogleBooksKeyField({ saved }: { saved: string }) {
  const [draft, setDraft] = useState(saved);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const submit = async (event: Event) => {
    event.preventDefault();
    const key = draft.trim();
    setBusy(true);
    try {
      await updateSettings({ googleBooksKey: key });
      if (!key) {
        setMessage(fr.settings.keyRemoved);
        return;
      }
      setMessage(fr.settings.keyChecking);
      const check = await checkGoogleBooksKey(key);
      if (check !== 'valid') {
        setMessage(KEY_CHECKS[check]);
        return;
      }
      setMessage(`${KEY_CHECKS.valid} ${fr.settings.keyRetrying}`);
      const { found } = await retryAllUnknown();
      setMessage(`${KEY_CHECKS.valid} ${fr.settings.keyFound(found)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="setting setting--stacked" onSubmit={(event) => void submit(event)}>
      <label class="setting__label" for="google-books-key">
        {fr.settings.keyLabel}
      </label>
      <p class="setting__detail" id="google-books-key-detail">
        {fr.settings.keyDetail}
      </p>
      <div class="inline-form">
        <input
          id="google-books-key"
          class="field__input mono inline-form__field"
          type="text"
          value={draft}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterKeyHint="done"
          aria-describedby="google-books-key-detail"
          onInput={(event) => {
            setDraft(event.currentTarget.value);
          }}
        />
        <button type="submit" class="button button--primary" disabled={busy || draft.trim() === saved}>
          {fr.settings.keySave}
        </button>
      </div>
      <p class="setting__status" role="status">
        {message}
      </p>
    </form>
  );
}

const MISTRAL_CHECKS = { valid: fr.settings.mistralValid, refused: fr.settings.mistralRefused, unverified: fr.settings.mistralUnverified };

/** Where the user creates a free key (lot 6). */
const MISTRAL_KEYS = 'https://console.mistral.ai/api-keys';

/** « Clé Mistral » (lot 6): checked once when saved; the covers photographed are then read. */
function MistralKeyField({ saved }: { saved: string }) {
  const [draft, setDraft] = useState(saved);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const submit = async (event: Event) => {
    event.preventDefault();
    const key = draft.trim();
    setBusy(true);
    try {
      await updateSettings({ mistralKey: key });
      if (!key) {
        setMessage(fr.settings.mistralRemoved);
        return;
      }
      setMessage(fr.settings.keyChecking);
      setMessage(MISTRAL_CHECKS[await checkMistralKey(key)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="setting setting--stacked" onSubmit={(event) => void submit(event)}>
      <label class="setting__label" for="mistral-key">
        {fr.settings.mistralLabel}
      </label>
      <p class="setting__detail" id="mistral-key-detail">
        {fr.settings.mistralDetail}{' '}
        <a href={MISTRAL_KEYS} target="_blank" rel="noopener noreferrer">
          {fr.settings.mistralCreate}
        </a>
      </p>
      <div class="inline-form">
        <input
          id="mistral-key"
          class="field__input mono inline-form__field"
          type="text"
          value={draft}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterKeyHint="done"
          aria-describedby="mistral-key-detail"
          onInput={(event) => {
            setDraft(event.currentTarget.value);
          }}
        />
        <button type="submit" class="button button--primary" disabled={busy || draft.trim() === saved}>
          {fr.settings.keySave}
        </button>
      </div>
      <p class="setting__status" role="status">
        {message}
      </p>
    </form>
  );
}

/** « Exporter (CSV, Excel) »: the file is saved at once, its content summed up below the card. */
function useExport(): { exporting: boolean; message: string; start: () => void } {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const start = () => {
    setExporting(true);
    setMessage(fr.settings.exporting);
    void exportLibrary()
      .then(({ text, books, copies }) => {
        if (books === 0) {
          setMessage(fr.settings.exportEmpty);
          return;
        }
        const fileName = fr.csv.fileName(isoDate(Date.now()));
        downloadText(fileName, text);
        setMessage(fr.settings.exported(fileName, books, copies));
      })
      .catch((error: unknown) => {
        console.error(error);
        setMessage(fr.settings.exportFailed);
      })
      .finally(() => {
        setExporting(false);
      });
  };
  return { exporting, message, start };
}

/** « Rechercher les couvertures manquantes »: a source may have been unavailable, or catalogued the book since. */
function MissingCovers() {
  const missing = useLiveQuery(() => booksWithoutCover(), [], []);
  const enrichment = useEnrichment();
  return (
    <div class="setting setting--stacked">
      <p class="setting__detail">{fr.settings.missingCovers(missing.length)}</p>
      {missing.length > 0 && (
        <button
          type="button"
          class="button button--secondary"
          disabled={enrichment.running}
          onClick={() => {
            enrichBooks(missing);
          }}
        >
          {fr.settings.searchCovers}
        </button>
      )}
      <EnrichmentStatus state={enrichment} />
    </div>
  );
}

function backupSummary(state: BackupState | undefined): string {
  if (!state?.refreshToken) return fr.backup.rowNotSet;
  if (state.lastError === 'refused') return fr.backup.rowReconnect;
  if (!state.enabled) return fr.backup.rowDisabled;
  return state.lastBackupAt ? fr.backup.rowLast(formatDateTime(new Date(state.lastBackupAt), new Date())) : fr.backup.rowNever;
}

const NOTIFICATIONS_MESSAGES = {
  enabled: fr.settings.loanNotificationsOn,
  unsupported: fr.settings.loanNotificationsUnsupported,
  denied: fr.settings.loanNotificationsDenied,
  notInstalled: fr.settings.loanNotificationsNotInstalled,
} as const;

/** « Prêts » (lot 4): the reminder in the app is always shown; the phone and the calendar are options. */
function LoanReminders({ settings }: { settings: Settings }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleNotifications = async (on: boolean) => {
    setBusy(true);
    setMessage('');
    if (on) setMessage(NOTIFICATIONS_MESSAGES[await enableLoanNotifications()]);
    else await disableLoanNotifications();
    setBusy(false);
  };

  return (
    <section class="section" aria-labelledby="loans-title">
      <h2 class="section__title" id="loans-title">
        {fr.settings.loansSection}
      </h2>
      <div class="card">
        <SwitchRow
          label={fr.settings.loanNotifications}
          detail={fr.settings.loanNotificationsDetail}
          checked={settings.loanNotifications}
          disabled={busy}
          onChange={(on) => void toggleNotifications(on)}
        />
        <SwitchRow
          label={fr.settings.loanCalendar}
          detail={fr.settings.loanCalendarDetail}
          checked={settings.loanCalendar}
          onChange={(loanCalendar) => void updateSettings({ loanCalendar })}
        />
      </div>
      <p class="status-line" role="status">
        {message}
      </p>
    </section>
  );
}

/** Screen 7. */
export function SettingsScreen() {
  const offline = useOfflineStatus();
  const storage = useStorageProtection();
  const settings = useLiveQuery<Settings>(() => getSettings(), [], DEFAULT_SETTINGS);
  const activeSources = SOURCES.filter(({ provider }) => settings.sources[provider]).length;
  const csvExport = useExport();
  const backup = useLiveQuery<BackupState | undefined>(() => getBackupState(), [], undefined);

  const set = (changes: Parameters<typeof updateSettings>[0]) => {
    void updateSettings(changes);
  };

  return (
    <Screen title={fr.settings.title}>
      <section class="section" aria-labelledby="backup-title">
        <h2 class="section__title" id="backup-title">
          {fr.backup.title}
        </h2>
        <div class="card">
          <a class="link-row link-row--detail" href={routeHref('backup')}>
            <span class="setting__text">
              <span class="setting__label">{fr.backup.settingsRow}</span>
              <span class="setting__detail">{backupSummary(backup)}</span>
            </span>
            <ChevronRightIcon size={18} />
          </a>
        </div>
      </section>

      <section class="section" aria-labelledby="scanning-title">
        <h2 class="section__title" id="scanning-title">
          {fr.settings.scanning}
        </h2>
        <div class="card">
          <SwitchRow
            label={fr.settings.sound}
            detail={fr.settings.soundDetail}
            checked={settings.scanSound}
            onChange={(scanSound) => {
              set({ scanSound });
            }}
          />
          <SwitchRow
            label={fr.settings.vibration}
            detail={fr.settings.vibrationDetail}
            checked={settings.scanVibration}
            onChange={(scanVibration) => {
              set({ scanVibration });
            }}
          />
          <SwitchRow
            label={fr.settings.flagOwned}
            detail={fr.settings.flagOwnedDetail}
            checked={settings.flagOwnedBooks}
            onChange={(flagOwnedBooks) => {
              set({ flagOwnedBooks });
            }}
          />
          <SwitchRow
            label={fr.settings.rememberOrder}
            detail={fr.settings.rememberOrderDetail}
            checked={settings.rememberShelfOrder}
            onChange={(rememberShelfOrder) => {
              set({ rememberShelfOrder });
            }}
          />
        </div>
      </section>

      <section class="section" aria-labelledby="covers-title">
        <h2 class="section__title" id="covers-title">
          {fr.settings.covers}
        </h2>
        <div class="card">
          <SwitchRow
            label={fr.settings.autoCovers}
            detail={fr.settings.autoCoversDetail}
            checked={settings.autoCovers}
            onChange={(autoCovers) => {
              set({ autoCovers });
            }}
          />
          {settings.autoCovers && <MissingCovers />}
        </div>
      </section>

      <section class="section" aria-labelledby="sources-title">
        <h2 class="section__title" id="sources-title">
          {fr.settings.sources}
        </h2>
        <div class="card">
          {SOURCES.map(({ provider, detail }) => {
            const checked = settings.sources[provider];
            // Without any source, every code would wait for a search forever.
            const last = checked && activeSources === 1;
            return (
              <SwitchRow
                key={provider}
                label={fr.common.providers[provider]}
                detail={last ? `${detail}. ${fr.settings.lastSource}` : detail}
                checked={checked}
                disabled={last}
                onChange={(on) => {
                  set({ sources: { [provider]: on } });
                }}
              />
            );
          })}
          {settings.sources.googleBooks && <GoogleBooksKeyField saved={settings.googleBooksKey} />}
        </div>
      </section>

      <section class="section" aria-labelledby="cover-reading-title">
        <h2 class="section__title" id="cover-reading-title">
          {fr.settings.mistralSection}
        </h2>
        <div class="card">
          <MistralKeyField saved={settings.mistralKey} />
        </div>
      </section>

      <LoanReminders settings={settings} />

      <section class="section" aria-labelledby="offline-title">
        <h2 class="section__title" id="offline-title">
          {fr.settings.offlineSection}
        </h2>
        <div class="card">
          <SwitchRow
            label={fr.settings.offlineScanning}
            detail={fr.settings.offlineScanningDetail}
            checked={settings.offlineScanning}
            onChange={(offlineScanning) => {
              set({ offlineScanning });
            }}
          />
        </div>
      </section>

      <section class="section" aria-labelledby="data-title">
        <h2 class="section__title" id="data-title">
          {fr.settings.myData}
        </h2>
        <div class="card">
          <a class="link-row" href={routeHref('places')}>
            {fr.settings.places}
            <ChevronRightIcon size={18} />
          </a>
          <a class="link-row" href={routeHref('labels')}>
            {fr.settings.labels}
            <ChevronRightIcon size={18} />
          </a>
          <button type="button" class="link-row" disabled={csvExport.exporting} onClick={csvExport.start}>
            {fr.settings.exportCsv}
            <DownloadIcon size={18} />
          </button>
          <a class="link-row" href={routeHref('import')}>
            {fr.settings.importCsv}
            <ChevronRightIcon size={18} />
          </a>
          <a class="link-row" href={routeHref('lists', LIST_TABS.insurance)}>
            {fr.settings.insurance}
            <ChevronRightIcon size={18} />
          </a>
        </div>
        <p class="status-line" role="status">
          {csvExport.message}
        </p>
      </section>

      <section class="section" aria-labelledby="about-title">
        <h2 class="section__title" id="about-title">
          {fr.settings.aboutTitle}
        </h2>
        <dl class="card">
          <div class="card__row">
            <dt class="card__label">{fr.settings.version}</dt>
            <dd class="card__value">
              {fr.settings.versionValue(__APP_VERSION__, formatDate(new Date(__BUILD_DATE__)))}
            </dd>
          </div>
          <div class="card__row">
            <dt class="card__label">{fr.settings.offline}</dt>
            <dd class="card__value">{OFFLINE_TEXTS[offline]}</dd>
          </div>
          <div class="card__row">
            <dt class="card__label">{fr.settings.storage}</dt>
            <dd class="card__value">{STORAGE_TEXTS[storage]}</dd>
          </div>
        </dl>
        <div class="card">
          <a class="link-row" href="./confidentialite.html">
            {fr.settings.privacy}
            <ChevronRightIcon size={18} />
          </a>
        </div>
      </section>
    </Screen>
  );
}
