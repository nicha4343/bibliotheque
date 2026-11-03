import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { LOAN_REMINDERS_TAG, NOTIFY_LOANS_MESSAGE } from '../loans/dates';
import { notifyDueLoans, openLoans } from './reminders';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

/** Periodic Background Sync (Chrome on Android, installed app): not yet in TypeScript's library. */
interface PeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string;
}

declare global {
  interface ServiceWorkerGlobalScopeEventMap {
    periodicsync: PeriodicSyncEvent;
  }
}

// What Workbox generated before lot 4: the app works offline, and an update waits for « Mettre à jour »
// (never a reload by itself, which would interrupt a scan).
self.addEventListener('message', (event) => {
  const type = (event.data as { type?: unknown } | null)?.type;
  if (type === 'SKIP_WAITING') void self.skipWaiting();
  if (type === NOTIFY_LOANS_MESSAGE) event.waitUntil(notifyDueLoans(self.registration));
});
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// « Notification à l’échéance »: Chrome wakes the service worker about once a day at most.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === LOAN_REMINDERS_TAG) event.waitUntil(notifyDueLoans(self.registration));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openLoans(self));
});
