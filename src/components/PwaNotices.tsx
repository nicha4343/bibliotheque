import { useRegisterSW } from 'virtual:pwa-register/preact';
import { fr } from '../textes/fr';

// A phone app may stay open for days: look for a new version every hour.
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

/** Banners announcing a new version (applied only on request) or offline readiness. */
export function PwaNotices() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update().catch(() => undefined);
      }, UPDATE_CHECK_INTERVAL);
    },
  });

  const postpone = () => {
    setNeedRefresh(false);
  };
  const update = () => {
    void updateServiceWorker(true);
  };
  const dismiss = () => {
    setOfflineReady(false);
  };

  if (needRefresh) {
    return (
      <div class="notice" role="status">
        <p class="notice__text">{fr.pwa.updateAvailable}</p>
        <div class="notice__actions">
          <button type="button" class="notice__button" onClick={postpone}>
            {fr.pwa.postpone}
          </button>
          <button type="button" class="notice__button notice__button--primary" onClick={update}>
            {fr.pwa.update}
          </button>
        </div>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div class="notice" role="status">
        <p class="notice__text">{fr.pwa.offlineReady}</p>
        <div class="notice__actions">
          <button type="button" class="notice__button notice__button--primary" onClick={dismiss}>
            {fr.pwa.dismiss}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
