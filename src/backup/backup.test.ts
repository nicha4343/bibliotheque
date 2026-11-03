import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUserCover } from '../books/books';
import { addQuote } from '../books/quotes';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book } from '../db/schema';
import { createRoom } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { backUp, findBackup, photoFileName, restoreBackup, SNAPSHOT_FILE } from './backup';
import { redirectUri, saveClient, updateBackupState } from './google';
import { buildSnapshot, parseSnapshot, restoreSnapshot } from './snapshot';

/** Google's token endpoint and Drive's hidden folder, in memory. */
class FakeGoogle {
  files = new Map<string, { name: string; content: Blob }>();
  refuse = false;
  uploads = 0;

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (url.hostname === 'oauth2.googleapis.com') {
      return this.refuse
        ? new Response('{"error":"invalid_grant"}', { status: 400 })
        : json({ access_token: 'access', expires_in: 3600 });
    }
    const id = url.pathname.split('/files/')[1];
    if (url.pathname.startsWith('/upload/')) {
      this.uploads += 1;
      const form = init.body as FormData;
      const metadata = JSON.parse(await (form.get('metadata') as Blob).text()) as { name?: string };
      const content = form.get('file') as Blob;
      if (method === 'PATCH' && id) {
        const file = this.files.get(id);
        if (file) file.content = content;
      } else {
        this.files.set(newId(), { name: metadata.name ?? '', content });
      }
      return json({});
    }
    if (method === 'DELETE' && id) {
      this.files.delete(id);
      return new Response(null, { status: 204 });
    }
    if (id) {
      const file = this.files.get(id);
      return file ? new Response(file.content, { status: 200 }) : new Response(null, { status: 404 });
    }
    return json({
      files: [...this.files].map(([fileId, file]) => ({
        id: fileId,
        name: file.name,
      })),
    });
  };

  names(): string[] {
    return [...this.files.values()].map((file) => file.name).sort();
  }
}

let database: LibraryDatabase;
let google: FakeGoogle;
let book: Book;

beforeEach(async () => {
  database = new LibraryDatabase(`test-${newId()}`);
  google = new FakeGoogle();
  vi.stubGlobal('fetch', google.fetch);
  const { shelf } = await createRoom('Salon', database);
  book = newBook({
    isbn13: '9782070360420',
    title: 'La Peste',
    authors: ['Albert Camus'],
    tags: ['Classique'],
  });
  await database.books.add(book);
  await database.copies.add(newCopy(book.id, shelf.id));
  await setUserCover(book.id, new Blob(['couverture']), database);
  await addQuote(book.id, { text: 'Le bacille de la peste ne meurt ni ne disparaît jamais.' }, database);
  await database.loans.add({ id: 'pret', copyId: 'exemplaire', borrower: 'Sam', lentAt: 1, dueAt: 2 });
  await saveClient('client.apps.googleusercontent.com', 'secret', database);
  await updateBackupState({ refreshToken: 'refresh' }, database);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
});

describe('contenu d’une sauvegarde', () => {
  it('restaure à l’identique les fiches, exemplaires, prêts, citations et photographies', async () => {
    const snapshot = await buildSnapshot(database);
    const other = new LibraryDatabase(`test-${newId()}`);
    await other.blobs.bulkAdd([...(await database.blobs.toArray()), { id: 'orpheline', blob: new Blob(['x']), createdAt: 0 }]);
    await restoreSnapshot(snapshot, other);
    expect(await buildSnapshot(other, snapshot.createdAt)).toEqual(snapshot);
    expect(await other.blobs.get('orpheline')).toBeUndefined();
    await other.delete();
  });

  it('refuse un fichier qui n’est pas une sauvegarde de l’application ou d’une version plus récente', async () => {
    const text = JSON.stringify(await buildSnapshot(database));
    expect(parseSnapshot(text)?.books).toHaveLength(1);
    expect(parseSnapshot('{"format":"autre"}')).toBeUndefined();
    expect(parseSnapshot(text.replace('"version":3', '"version":99'))).toBeUndefined();
    expect(parseSnapshot('pas du JSON')).toBeUndefined();
    // A backup made before the loans (lot 4), or before the wishes and series (lot 5), is still read.
    const before = JSON.parse(text) as Record<string, unknown>;
    delete before.loans;
    delete before.wishes;
    delete before.series;
    expect(parseSnapshot(JSON.stringify({ ...before, version: 1 }))).toMatchObject({ loans: [], wishes: [], series: [] });
    expect(parseSnapshot(JSON.stringify({ ...before, version: 2 }))).toBeUndefined();
    expect(parseSnapshot(JSON.stringify({ ...before, loans: [], version: 2 }))).toMatchObject({ wishes: [], series: [] });
    expect(parseSnapshot(JSON.stringify({ ...before, loans: [], version: 3 }))).toBeUndefined();
  });

  it('conserve les souhaits et le nombre de tomes des séries', async () => {
    await database.wishes.add({ id: 'souhait', title: 'Les Choses', source: 'manual', createdAt: 1 });
    await database.series.put({ id: 'asterix', total: 39 });
    const snapshot = await buildSnapshot(database);
    expect(snapshot.version).toBe(3);
    const other = new LibraryDatabase(`test-${newId()}`);
    await restoreSnapshot(snapshot, other);
    expect(await other.wishes.toArray()).toEqual([{ id: 'souhait', title: 'Les Choses', source: 'manual', createdAt: 1 }]);
    expect(await other.series.get('asterix')).toEqual({ id: 'asterix', total: 39 });
    await other.delete();
  });
});

describe('sauvegarde sur Google Drive', () => {
  it('envoie les photographies puis les fiches, et rien de plus tant que rien ne change', async () => {
    expect(await backUp({}, database)).toBe(true);
    const cover = (await database.books.get(book.id))?.cover?.blobId ?? '';
    expect(google.names()).toEqual([photoFileName(cover), SNAPSHOT_FILE].sort());
    expect((await database.backup.get('drive'))?.lastBackupAt).toBeTypeOf('number');
    const uploads = google.uploads;
    expect(await backUp({}, database)).toBe(true);
    expect(google.uploads).toBe(uploads);
  });

  it('retire de Drive la photographie que la bibliothèque n’emploie plus', async () => {
    await backUp({}, database);
    await setUserCover(book.id, new Blob(['nouvelle couverture']), database);
    await backUp({}, database);
    const cover = (await database.books.get(book.id))?.cover?.blobId ?? '';
    expect(google.names()).toEqual([photoFileName(cover), SNAPSHOT_FILE].sort());
  });

  it('signale un accès retiré par Google, sans lever d’erreur', async () => {
    google.refuse = true;
    expect(await backUp({}, database)).toBe(false);
    expect((await database.backup.get('drive'))?.lastError).toBe('refused');
  });

  it('ne sauvegarde pas lorsque la sauvegarde automatique est désactivée, sauf à la demande', async () => {
    await updateBackupState({ enabled: false }, database);
    expect(await backUp({}, database)).toBe(false);
    expect(google.uploads).toBe(0);
    expect(await backUp({ force: true }, database)).toBe(true);
  });

  it('restaure la sauvegarde sur un autre téléphone, photographies comprises', async () => {
    await backUp({}, database);
    const phone = new LibraryDatabase(`test-${newId()}`);
    await saveClient('client.apps.googleusercontent.com', 'secret', phone);
    await updateBackupState({ refreshToken: 'refresh' }, phone);
    const found = await findBackup(phone);
    expect(found?.snapshot.books.map((item) => item.title)).toEqual(['La Peste']);
    const progress: number[] = [];
    if (found) await restoreBackup(found, (done) => progress.push(done), phone);
    expect(progress).toEqual([0, 1]);
    const restored = await phone.books.get(book.id);
    expect(restored?.tags).toEqual(['Classique']);
    expect(await (await phone.blobs.get(restored?.cover?.blobId ?? ''))?.blob.text()).toBe('couverture');
    expect(await phone.quotes.count()).toBe(1);
    // The restored library is the backup itself: nothing to upload.
    const uploads = google.uploads;
    await backUp({}, phone);
    expect(google.uploads).toBe(uploads);
    await phone.delete();
  });

  it('déduit l’adresse de retour de l’adresse de l’application', () => {
    expect(
      redirectUri({
        origin: 'https://nicha4343.github.io',
        pathname: '/bibliotheque/index.html',
      }),
    ).toBe('https://nicha4343.github.io/bibliotheque/');
  });
});
