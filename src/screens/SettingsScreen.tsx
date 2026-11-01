import { useEffect, useState } from 'preact/hooks';
import { Screen } from '../components/Screen';
import { getStorageProtection, type StorageProtection } from '../db/storage';
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

/** Screen 7. Lot 0: « À propos » only; the version 1 settings come with lot 1. */
export function SettingsScreen() {
  const offline = useOfflineStatus();
  const storage = useStorageProtection();

  return (
    <Screen title={fr.settings.title}>
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
