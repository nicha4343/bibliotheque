import { useEffect, useState } from 'preact/hooks';
import { ChevronRightIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { SwitchRow } from '../components/SwitchRow';
import type { MetadataProvider, Settings } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../db/settings';
import { getStorageProtection, type StorageProtection } from '../db/storage';
import { useLiveQuery } from '../db/useLiveQuery';
import { checkGoogleBooksKey } from '../metadata/googleBooksKey';
import { retryAllUnknown } from '../pending/pending';
import { routeHref } from '../router';
import { formatDate, fr } from '../textes/fr';

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

/** Screen 7, version 1. « Mémoriser l’ordre sur l’étagère » comes with lot 3, which uses it. */
export function SettingsScreen() {
  const offline = useOfflineStatus();
  const storage = useStorageProtection();
  const settings = useLiveQuery<Settings>(() => getSettings(), [], DEFAULT_SETTINGS);
  const activeSources = SOURCES.filter(({ provider }) => settings.sources[provider]).length;

  const set = (changes: Parameters<typeof updateSettings>[0]) => {
    void updateSettings(changes);
  };

  return (
    <Screen title={fr.settings.title}>
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
        </div>
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
      </section>
    </Screen>
  );
}
