import { DATABASE_NAME, SETTINGS_KEY, type Book, type Copy, type Loan, type SettingsRecord } from '../db/schema';
import { loansToNotify, reminderNotification } from '../loans/dates';
import { fr } from '../textes/fr';

// The service worker reads the database without Dexie, which belongs to the page: it never creates
// nor upgrades it, and closes it at once so that an upgrade by the page is never blocked.

/** Route of the loans screen (ROUTE_HASHES.loans in router.ts, which the service worker does not load). */
const LOANS_HASH = '#/prets';

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB'));
    };
  });

function openDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME);
    // No database yet: the app has never been opened on this device.
    request.onupgradeneeded = () => {
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(undefined);
    };
  });
}

/**
 * Notifies the loans whose return day has come, once each, if « Notification à l’échéance » is on.
 * One notification names them all (three at most).
 */
export async function notifyDueLoans(registration: ServiceWorkerRegistration, now = new Date()): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  database.onversionchange = () => {
    database.close();
  };
  try {
    const stores = ['settings', 'loans', 'copies', 'books'];
    if (!stores.every((name) => database.objectStoreNames.contains(name))) return;
    const read = database.transaction(stores, 'readonly');
    const [settings, loans, copies, books] = await Promise.all([
      done(read.objectStore('settings').get(SETTINGS_KEY)) as Promise<SettingsRecord | undefined>,
      done(read.objectStore('loans').getAll()) as Promise<Loan[]>,
      done(read.objectStore('copies').getAll()) as Promise<Copy[]>,
      done(read.objectStore('books').getAll()) as Promise<Book[]>,
    ]);
    if (!settings?.loanNotifications) return;
    const due = loansToNotify(loans, now);
    if (due.length === 0) return;

    const bookOfCopy = new Map(copies.map((copy) => [copy.id, copy.bookId]));
    const titles = new Map(books.map((book) => [book.id, book.title]));
    const { title, body } = reminderNotification(
      due.map((loan) => ({ title: titles.get(bookOfCopy.get(loan.copyId) ?? '') || fr.common.untitled, borrower: loan.borrower })),
    );
    await registration.showNotification(title, { body, tag: 'loans-due', icon: 'pwa-192x192.png' });

    const write = database.transaction('loans', 'readwrite');
    for (const loan of due) write.objectStore('loans').put({ ...loan, notifiedAt: now.getTime() });
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => {
        resolve();
      };
      write.onerror = () => {
        reject(write.error ?? new Error('IndexedDB'));
      };
    });
  } catch {
    // Notifications refused meanwhile, or the database being upgraded: the next check will do.
  } finally {
    database.close();
  }
}

/** A touch on the notification opens the loans screen, in the open app if there is one. */
export async function openLoans(scope: ServiceWorkerGlobalScope): Promise<void> {
  const url = new URL(LOANS_HASH, scope.registration.scope).href;
  const [client] = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!client) {
    await scope.clients.openWindow(url);
    return;
  }
  await client.focus();
  await client.navigate(url).catch(() => undefined);
}
