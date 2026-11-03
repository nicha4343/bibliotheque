import { getSettings, updateSettings } from '../db/settings';
import { fr } from '../textes/fr';
import { LOAN_REMINDERS_TAG, NOTIFY_LOANS_MESSAGE } from './dates';

// « Notification à l’échéance » (lot 4): the service worker (src/sw/reminders.ts) checks the loans
// when Chrome wakes it, about once a day. Periodic Background Sync exists only in Chrome, and Chrome
// grants it only to an installed app.

interface PeriodicSyncManager {
  register(tag: string, options?: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
}

type SyncRegistration = ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager };

/** Asked of Chrome, which may wake the service worker less often. */
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** None while developing (no service worker) or before the first registration. */
async function getRegistration(): Promise<SyncRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  return navigator.serviceWorker.getRegistration();
}

const periodicSyncGranted = async (): Promise<boolean> => {
  try {
    const { state } = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    return state === 'granted';
  } catch {
    return false;
  }
};

export type NotificationsResult = 'enabled' | 'unsupported' | 'denied' | 'notInstalled';

/** Switched on from the settings: permission, daily check, a test notification, then the loans already due. */
export async function enableLoanNotifications(): Promise<NotificationsResult> {
  const registration = await getRegistration();
  if (!registration?.periodicSync || typeof Notification === 'undefined') return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  if (!(await periodicSyncGranted())) return 'notInstalled';
  try {
    await registration.periodicSync.register(LOAN_REMINDERS_TAG, { minInterval: MIN_INTERVAL_MS });
  } catch {
    return 'notInstalled';
  }
  await updateSettings({ loanNotifications: true });
  await registration.showNotification(fr.loanReminders.enabledTitle, {
    body: fr.loanReminders.enabledBody,
    tag: 'loans-enabled',
    icon: 'pwa-192x192.png',
  });
  registration.active?.postMessage({ type: NOTIFY_LOANS_MESSAGE });
  return 'enabled';
}

export async function disableLoanNotifications(): Promise<void> {
  await updateSettings({ loanNotifications: false });
  await (await getRegistration())?.periodicSync?.unregister(LOAN_REMINDERS_TAG).catch(() => undefined);
}

/**
 * At start-up: the daily check is registered again. The option is switched off when this phone does
 * not allow it (a backup restored on another phone, notifications refused since).
 */
export async function refreshLoanNotifications(): Promise<void> {
  if (!(await getSettings()).loanNotifications) return;
  const registration = await getRegistration();
  if (!registration) return;
  const allowed =
    registration.periodicSync !== undefined &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    (await periodicSyncGranted());
  if (!allowed) {
    await disableLoanNotifications();
    return;
  }
  await registration.periodicSync?.register(LOAN_REMINDERS_TAG, { minInterval: MIN_INTERVAL_MS }).catch(() => undefined);
}
