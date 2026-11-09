import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveClient, UnknownAccount, updateBackupState, DRIVE_FILE_SCOPE, DRIVE_SCOPE } from '../backup/google';
import { LibraryDatabase } from '../db/db';
import { newId } from '../db/ids';
import type { Book, Room, Shelf, Site } from '../db/schema';
import { createRoom, createSite, deleteSiteIfEmpty } from '../places/places';
import { newBook, newCopy } from '../scan/session';
import { cacheCovers, completeOpening, leaveSharedPlace, openInvitation, refreshSharedPlaces, sharedPhotoKey } from './guest';
import { decodeInvitation, encodeInvitation, type Invitation } from './invitation';
import { invitationLink, inviteGuest, loadGuests, removeGuest, sharePlace, stopSharing, uploadSharedPlaces } from './owner';
import { findSharedBook } from './sharedLibrary';
import { contentsHash, decodeSharedFile, encodeSharedFile, placeContents, SHARED_FORMAT, type SharedFile } from './sharedFile';

const keep = (photo: Blob) => Promise.resolve(photo);

/** Google's token endpoint, the owner's Drive and the people its files are shared with, in memory. */
class FakeDrive {
  files = new Map<string, { name: string; content: Blob; version: number; permissions: { id: string; email: string }[] }>();
  uploads = 0;
  downloads = 0;

  readonly fetch = (input: string, init: RequestInit = {}): Promise<Response> => Promise.resolve(this.answer(input, init));

  private answer(input: string, init: RequestInit): Response {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const json = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status: 200, headers });
    const missing = () => new Response('{}', { status: 404 });
    if (url.hostname === 'oauth2.googleapis.com') {
      return json({ access_token: 'access', expires_in: 3600, refresh_token: 'refresh-invite', scope: DRIVE_FILE_SCOPE });
    }
    if (url.pathname.endsWith('/about')) return json({ user: { displayName: 'Nicolas' } });
    if (url.hostname === 'session.test') {
      const id = url.pathname.slice(1);
      const file = this.files.get(id);
      if (!file) return missing();
      file.content = init.body as Blob;
      file.version += 1;
      this.uploads += 1;
      return json({ id });
    }
    const [, rest = ''] = url.pathname.split('/files');
    const [, id, sub, permissionId] = rest.split('/');
    if (url.pathname.startsWith('/upload/')) {
      const metadata = JSON.parse(init.body as string) as { name: string };
      const fileId = id ?? newId();
      if (!id) this.files.set(fileId, { name: metadata.name, content: new Blob(), version: 0, permissions: [] });
      const file = this.files.get(fileId);
      if (!file) return missing();
      file.name = metadata.name;
      return json({}, { Location: `https://session.test/${fileId}` });
    }
    const file = id ? this.files.get(id) : undefined;
    if (!file || !id) return missing();
    if (sub === 'permissions') {
      if (method === 'POST') {
        const { emailAddress } = JSON.parse(init.body as string) as { emailAddress: string };
        if (emailAddress.startsWith('inconnu')) return new Response('{}', { status: 400 });
        file.permissions.push({ id: newId(), email: emailAddress });
        return json({});
      }
      if (method === 'DELETE') {
        file.permissions = file.permissions.filter((permission) => permission.id !== permissionId);
        return new Response(null, { status: 204 });
      }
      return json({
        permissions: [
          { id: 'owner', type: 'user', role: 'owner', emailAddress: 'nicolas@gmail.com' },
          ...file.permissions.map((p) => ({ id: p.id, type: 'user', role: 'reader', emailAddress: p.email })),
        ],
      });
    }
    if (method === 'DELETE') {
      this.files.delete(id);
      return new Response(null, { status: 204 });
    }
    if (url.searchParams.get('alt') === 'media') {
      this.downloads += 1;
      return new Response(file.content, { status: 200 });
    }
    return json({ id, name: file.name, version: String(file.version) });
  }
}

let owner: LibraryDatabase;
let guest: LibraryDatabase;
let drive: FakeDrive;
let country: Site;
let peste: Book;
let candide: Book;
let lotus: Book;
let assigned: string[];

beforeEach(async () => {
  owner = new LibraryDatabase(`test-${newId()}`);
  guest = new LibraryDatabase(`test-${newId()}`);
  drive = new FakeDrive();
  assigned = [];
  vi.stubGlobal('fetch', drive.fetch);
  vi.stubGlobal('window', {
    location: {
      origin: 'https://exemple.test',
      pathname: '/bibliotheque/',
      hash: '',
      assign: (url: string) => {
        assigned.push(url);
      },
    },
  });
  const { shelf: home } = await createRoom('Salon', owner);
  country = await createSite('Maison de campagne', owner);
  const { shelf: barn } = await createRoom('Grange', owner, country.id);
  peste = newBook({ isbn13: '9782070360420', title: 'La Peste', authors: ['Albert Camus'], tags: [] });
  candide = {
    ...newBook({ isbn13: '9782070413799', title: 'Candide', authors: ['Voltaire'], tags: ['Conte'] }),
    price: 8.5,
    cover: { source: 'user', blobId: 'photo-candide' },
  };
  lotus = {
    ...newBook({ isbn13: '9782203001145', title: 'Le Lotus bleu', authors: ['Hergé'], tags: [] }),
    cover: { source: 'auto', url: 'https://covers.test/lotus.jpg', provider: 'openLibrary', blobId: 'cover-lotus' },
  };
  await owner.books.bulkAdd([peste, candide, lotus]);
  await owner.copies.bulkAdd([newCopy(peste.id, home.id), newCopy(candide.id, barn.id), newCopy(lotus.id, barn.id)]);
  await owner.blobs.bulkAdd([
    { id: 'photo-candide', blob: new Blob(['candide'], { type: 'image/jpeg' }), createdAt: 0 },
    { id: 'cover-lotus', blob: new Blob(['lotus'], { type: 'image/jpeg' }), createdAt: 0 },
  ]);
  await owner.readings.add({ bookId: candide.id, status: 'read', rating: 5, review: 'Excellent', updatedAt: 0 });
  await saveClient('123-abc.apps.googleusercontent.com', 'secret', owner);
  await updateBackupState({ refreshToken: 'refresh', scopes: [DRIVE_SCOPE, DRIVE_FILE_SCOPE] }, owner);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await owner.delete();
  await guest.delete();
});

const records = async (database: LibraryDatabase) => ({
  sites: await database.sites.toArray(),
  rooms: await database.rooms.toArray(),
  shelves: await database.shelves.toArray(),
  books: await database.books.toArray(),
  copies: await database.copies.toArray(),
});

describe('contenu d’un lieu partagé', () => {
  it('ne contient que les ouvrages du lieu, sans prix ni lecture, et les photographies de l’utilisateur', async () => {
    const built = placeContents(country.id, await records(owner));
    expect(built?.contents.site).toEqual({ id: country.id, name: 'Maison de campagne', order: country.order });
    expect(built?.contents.rooms.map((room: Room) => room.name)).toEqual(['Grange']);
    expect(built?.contents.shelves.every((shelf: Shelf) => shelf.qrToken === '')).toBe(true);
    expect(built?.contents.books.map((book) => book.title).sort()).toEqual(['Candide', 'Le Lotus bleu']);
    expect(built?.contents.copies).toHaveLength(2);
    const shared = built?.contents.books.find((book) => book.id === candide.id);
    expect(shared?.price).toBeUndefined();
    expect(shared?.cover).toEqual({ source: 'user', blobId: 'photo-candide' });
    // An automatic cover travels as its address: each guest downloads it.
    expect(built?.contents.books.find((book) => book.id === lotus.id)?.cover).toEqual({
      source: 'auto',
      url: 'https://covers.test/lotus.jpg',
      provider: 'openLibrary',
    });
    expect(built?.photoIds).toEqual(['photo-candide']);
    expect(placeContents('inconnu', await records(owner))).toBeUndefined();
  });

  it('a la même empreinte tant que le lieu ne change pas', async () => {
    const first = placeContents(country.id, await records(owner));
    const again = placeContents(country.id, await records(owner));
    if (!first || !again) throw new Error('lieu absent');
    expect(await contentsHash('Nicolas', first.contents, first.photoIds)).toBe(await contentsHash('Nicolas', again.contents, again.photoIds));
    await owner.sites.update(country.id, { name: 'Malzaure' });
    const renamed = placeContents(country.id, await records(owner));
    if (!renamed) throw new Error('lieu absent');
    expect(await contentsHash('Nicolas', renamed.contents, renamed.photoIds)).not.toBe(
      await contentsHash('Nicolas', first.contents, first.photoIds),
    );
  });

  it('se relit après compression, et refuse un autre fichier', async () => {
    const built = placeContents(country.id, await records(owner));
    if (!built) throw new Error('lieu absent');
    const file: SharedFile = { format: SHARED_FORMAT, version: 1, createdAt: 5, owner: 'Nicolas', ...built.contents, photos: [] };
    expect(await decodeSharedFile(await encodeSharedFile(file))).toEqual(file);
    expect(await decodeSharedFile(await encodeSharedFile({ ...file, version: 99 }))).toBeUndefined();
    expect(await decodeSharedFile(new Blob(['pas un fichier']))).toBeUndefined();
  });
});

describe('invitation', () => {
  const invitation: Invitation = {
    fileId: 'fichier',
    place: 'Maison de campagne',
    owner: 'Nicolas',
    clientId: '123-abc.apps.googleusercontent.com',
    clientSecret: 'secret',
  };

  it('tient dans le lien et se relit', async () => {
    const payload = await encodeInvitation(invitation);
    expect(payload).toMatch(/^[\w-]+$/);
    expect(await decodeInvitation(payload)).toEqual(invitation);
  });

  it('refuse un lien tronqué', async () => {
    const payload = await encodeInvitation(invitation);
    expect(await decodeInvitation(payload.slice(0, 20))).toBeUndefined();
    expect(await decodeInvitation('nimporte-quoi')).toBeUndefined();
  });
});

describe('partage d’un lieu', () => {
  it('crée le fichier du lieu, puis ne l’envoie de nouveau que s’il a changé', async () => {
    await sharePlace(country.id, owner, keep);
    const site = await owner.sites.get(country.id);
    expect(site?.share).toMatchObject({ owner: 'Nicolas' });
    const fileId = site?.share?.fileId ?? '';
    expect(drive.files.get(fileId)?.name).toBe('Ma bibliothèque · Maison de campagne');
    expect(drive.uploads).toBe(1);

    await uploadSharedPlaces(owner, keep);
    expect(drive.uploads).toBe(1);

    // A book of the main house is not shared: nothing to send.
    await owner.books.update(peste.id, { title: 'La Peste (édition illustrée)' });
    await uploadSharedPlaces(owner, keep);
    expect(drive.uploads).toBe(1);

    await owner.sites.update(country.id, { name: 'Malzaure' });
    await uploadSharedPlaces(owner, keep);
    expect(drive.uploads).toBe(2);
    expect(drive.files.get(fileId)?.name).toBe('Ma bibliothèque · Malzaure');
    expect((await owner.shareUploads.get(fileId))?.lastError).toBeUndefined();
  });

  it('invite et retire une personne, refuse une adresse sans compte Google', async () => {
    await sharePlace(country.id, owner, keep);
    const fileId = (await owner.sites.get(country.id))?.share?.fileId ?? '';
    await inviteGuest(fileId, ' lea@gmail.com ', owner);
    const guests = await loadGuests(fileId, owner);
    expect(guests.map((person) => person.email)).toEqual(['lea@gmail.com']);
    await expect(inviteGuest(fileId, 'inconnu@exemple.fr', owner)).rejects.toBeInstanceOf(UnknownAccount);
    await removeGuest(fileId, guests[0]?.permissionId ?? '', owner);
    expect(await loadGuests(fileId, owner)).toEqual([]);
  });

  it('ne supprime pas un lieu partagé, et cesse de le partager en supprimant son fichier', async () => {
    await owner.copies.clear();
    await sharePlace(country.id, owner, keep);
    expect(await deleteSiteIfEmpty(country.id, owner)).toBe(false);
    await stopSharing(country.id, owner);
    expect(drive.files.size).toBe(0);
    expect((await owner.sites.get(country.id))?.share).toBeUndefined();
    expect(await deleteSiteIfEmpty(country.id, owner)).toBe(true);
  });
});

describe('lieu partagé avec l’utilisateur', () => {
  async function invitation(): Promise<Invitation> {
    await sharePlace(country.id, owner, keep);
    const site = await owner.sites.get(country.id);
    if (!site) throw new Error('lieu absent');
    const link = await invitationLink(site, owner, 'https://exemple.test/bibliotheque/#/parametres');
    expect(link.startsWith('https://exemple.test/bibliotheque/#/invitation/')).toBe(true);
    const decoded = await decodeInvitation(link.split('/').pop() ?? '');
    if (!decoded) throw new Error('invitation illisible');
    return decoded;
  }

  async function open(): Promise<string> {
    const received = await invitation();
    await openInvitation(received, guest);
    const pending = (await guest.sharedPlaces.get(received.fileId))?.pendingSignIn;
    const google = new URL(assigned[0] ?? '');
    expect(google.searchParams.get('trigger_onepick')).toBe('true');
    expect(google.searchParams.get('file_ids')).toBe(received.fileId);
    expect(google.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
    expect(await completeOpening({ state: pending?.state ?? '', code: 'code', pickedFileIds: [received.fileId] }, guest)).toBe('opened');
    return received.fileId;
  }

  it('s’ouvre par le sélecteur de Google, puis est copié sur l’appareil, photographies comprises', async () => {
    const fileId = await open();
    const place = await guest.sharedPlaces.get(fileId);
    expect(place).toMatchObject({ name: 'Maison de campagne', owner: 'Nicolas', refreshToken: 'refresh-invite' });
    expect(place?.contents?.books.map((book) => book.title).sort()).toEqual(['Candide', 'Le Lotus bleu']);
    expect(await (await guest.sharedPhotos.get(sharedPhotoKey(fileId, 'photo-candide')))?.blob.text()).toBe('candide');
    // The owner's readings stay with the owner.
    expect(await guest.readings.count()).toBe(0);
    expect(await findSharedBook('9782070413799', guest)).toMatchObject({ place: 'Maison de campagne', label: 'Grange · Étagère 1' });
    expect(await findSharedBook('9782070360420', guest)).toBeUndefined();
  });

  it('n’est relu que si le propriétaire l’a changé', async () => {
    const fileId = await open();
    expect(drive.downloads).toBe(1);
    await refreshSharedPlaces(guest);
    expect(drive.downloads).toBe(1);
    await owner.books.update(candide.id, { title: 'Candide ou l’Optimisme' });
    await uploadSharedPlaces(owner, keep);
    await refreshSharedPlaces(guest);
    expect(drive.downloads).toBe(2);
    expect((await guest.sharedPlaces.get(fileId))?.contents?.books.find((book) => book.id === candide.id)?.title).toBe(
      'Candide ou l’Optimisme',
    );
  });

  it('s’efface quand le propriétaire cesse de le partager, et laisse un avis', async () => {
    const fileId = await open();
    await stopSharing(country.id, owner);
    await refreshSharedPlaces(guest);
    const place = await guest.sharedPlaces.get(fileId);
    expect(place?.endedAt).toBeDefined();
    expect(place?.contents).toBeUndefined();
    expect(await guest.sharedPhotos.count()).toBe(0);
    await leaveSharedPlace(fileId, guest);
    expect(await guest.sharedPlaces.count()).toBe(0);
  });

  it('distingue une ouverture annulée et un retour de Google qui ne la concerne pas', async () => {
    const received = await invitation();
    await openInvitation(received, guest);
    expect(await completeOpening({ state: 'autre', code: 'code', pickedFileIds: [] }, guest)).toBe('none');
    const pending = (await guest.sharedPlaces.get(received.fileId))?.pendingSignIn;
    expect(await completeOpening({ state: pending?.state ?? '', pickedFileIds: [] }, guest)).toBe('cancelled');
    expect((await guest.sharedPlaces.get(received.fileId))?.refreshToken).toBeUndefined();
  });

  it('télécharge les couvertures automatiques pour les montrer hors connexion', async () => {
    const fileId = await open();
    vi.stubGlobal('navigator', { onLine: true });
    const covers = vi.fn(() => Promise.resolve(new Response(new Blob(['image'], { type: 'image/jpeg' }), { status: 200 })));
    await cacheCovers(fileId, guest, covers);
    expect(covers).toHaveBeenCalledTimes(1);
    expect(await guest.sharedPhotos.get(sharedPhotoKey(fileId, 'https://covers.test/lotus.jpg'))).toBeDefined();
    await cacheCovers(fileId, guest, covers);
    expect(covers).toHaveBeenCalledTimes(1);
  });
});
