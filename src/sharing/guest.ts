import {
  authorizationUrl,
  BackupFailure,
  DRIVE_FILE_SCOPE,
  fileInfo,
  freshToken,
  goToGoogle,
  MissingFile,
  newPendingSignIn,
  readDriveFile,
  redirectUri,
  requestToken,
  type GoogleReturn,
} from '../backup/google';
import { db, type LibraryDatabase } from '../db/db';
import type { Book, SharedPlace } from '../db/schema';
import { routeHref } from '../router';
import type { Invitation } from './invitation';
import { base64ToBlob, coverPhotoId, decodeSharedFile, type SharedFile } from './sharedFile';

// Lot 13, guest's side: a place someone shares with the person using this device. It is opened once
// with Google's file picker (the only way the permission drive.file reaches a file someone else
// created), with the owner's Google client given by the invitation; then a copy is kept on the device,
// read offline and updated when the owner's file changes. Nothing is ever written to the file.

/** Key of a picture of a shared place: its file, then the photograph's id or the cover's address. */
export const sharedPhotoKey = (fileId: string, key: string): string => `${fileId} ${key}`;

/** Key of the picture of a book of a shared place, if it has one. */
export function bookPhotoKey(fileId: string, book: Pick<Book, 'cover'>): string | undefined {
  const key = coverPhotoId(book.cover) ?? book.cover?.url;
  return key ? sharedPhotoKey(fileId, key) : undefined;
}

/** Leaves the app for Google's page: sign-in, then the file picker showing the shared file only. */
async function goToPicker(place: Pick<SharedPlace, 'fileId' | 'clientId'>, database: LibraryDatabase): Promise<void> {
  const pendingSignIn = newPendingSignIn();
  await database.sharedPlaces.update(place.fileId, { pendingSignIn });
  const url = await authorizationUrl(place.clientId, DRIVE_FILE_SCOPE, pendingSignIn, {
    trigger_onepick: 'true',
    file_ids: place.fileId,
  });
  goToGoogle(url, pendingSignIn.state, routeHref('sharedPlace', place.fileId));
}

/** « Ouvrir avec Google », from the invitation. */
export async function openInvitation(invitation: Invitation, database: LibraryDatabase = db): Promise<void> {
  const known = await database.sharedPlaces.get(invitation.fileId);
  const place: SharedPlace = {
    ...known,
    fileId: invitation.fileId,
    name: known?.contents ? known.name : invitation.place,
    owner: invitation.owner,
    clientId: invitation.clientId,
    clientSecret: invitation.clientSecret,
  };
  delete place.endedAt;
  await database.sharedPlaces.put(place);
  await goToPicker(place, database);
}

/** Opens the place again with Google, when the access granted before was withdrawn. */
export async function reopenPlace(fileId: string, database: LibraryDatabase = db): Promise<void> {
  const place = await database.sharedPlaces.get(fileId);
  if (place) await goToPicker(place, database);
}

export type OpeningResult = 'none' | 'opened' | 'cancelled' | 'notPicked' | 'failed';

let opening: Promise<OpeningResult> | undefined;

/** Outcome of the return from Google's file picker, given once to the screen of the place. */
export function takeOpeningResult(): Promise<OpeningResult> | undefined {
  const result = opening;
  opening = undefined;
  return result;
}

/**
 * On return from Google's page: exchanges the code for the place's own tokens, then copies the place.
 * 'none' when the sign-in was not the opening of a shared place.
 */
export function completeOpening(returned: GoogleReturn, database: LibraryDatabase = db): Promise<OpeningResult> {
  opening = finishOpening(returned, database);
  return opening;
}

async function finishOpening(returned: GoogleReturn, database: LibraryDatabase): Promise<OpeningResult> {
  const place = (await database.sharedPlaces.toArray()).find((candidate) => candidate.pendingSignIn?.state === returned.state);
  if (!place?.pendingSignIn) return 'none';
  const { verifier } = place.pendingSignIn;
  await database.sharedPlaces.update(place.fileId, { pendingSignIn: undefined });
  // The screen of the place, if the device could not keep it before leaving for Google.
  const hash = routeHref('sharedPlace', place.fileId);
  if (window.location.hash !== hash) window.location.hash = hash;
  if (!returned.code) return 'cancelled';
  try {
    const tokens = await requestToken(
      { grant_type: 'authorization_code', code: returned.code, code_verifier: verifier, redirect_uri: redirectUri() },
      place,
    );
    if (!tokens.refresh_token) return 'failed';
    const stored = {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    };
    try {
      await fileInfo(tokens.access_token, place.fileId);
    } catch (error) {
      // Another file chosen, or a Google account the place is not shared with.
      if (error instanceof MissingFile) return 'notPicked';
      throw error;
    }
    await database.sharedPlaces.update(place.fileId, { ...stored, lastError: undefined, endedAt: undefined });
  } catch {
    return 'failed';
  }
  const refreshed = await database.sharedPlaces.get(place.fileId);
  if (refreshed) await refreshPlace(refreshed, database, true);
  return 'opened';
}

/** The copy of the file, kept on the device in one transaction; pictures no longer used are removed. */
async function storeFile(fileId: string, version: string, file: SharedFile, database: LibraryDatabase): Promise<void> {
  const { site, rooms, shelves, books, copies } = file;
  const used = new Set(books.flatMap((book) => bookPhotoKey(fileId, book) ?? []));
  await database.transaction('rw', database.sharedPlaces, database.sharedPhotos, async () => {
    const stale = (await database.sharedPhotos.where('fileId').equals(fileId).primaryKeys()).filter((key) => !used.has(key));
    await database.sharedPhotos.bulkDelete(stale);
    await database.sharedPhotos.bulkPut(
      file.photos.map((photo) => ({ id: sharedPhotoKey(fileId, photo.id), fileId, blob: base64ToBlob(photo.data) })),
    );
    await database.sharedPlaces.update(fileId, {
      name: site.name,
      owner: file.owner,
      version,
      contents: { site, rooms, shelves, books, copies },
      updatedAt: file.createdAt,
      checkedAt: Date.now(),
      lastError: undefined,
      endedAt: undefined,
    });
  });
}

/** The owner stopped sharing, or removed this person: the copy is erased, a notice remains. */
async function endPlace(fileId: string, database: LibraryDatabase): Promise<void> {
  await database.transaction('rw', database.sharedPlaces, database.sharedPhotos, async () => {
    await database.sharedPhotos.where('fileId').equals(fileId).delete();
    await database.sharedPlaces.update(fileId, {
      contents: undefined,
      version: undefined,
      refreshToken: undefined,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      lastError: undefined,
      endedAt: Date.now(),
    });
  });
}

/** Reads the owner's file if it changed since the last copy (always when force). Never throws. */
async function refreshPlace(place: SharedPlace, database: LibraryDatabase, force = false): Promise<void> {
  const save = (changes: Partial<SharedPlace>) => database.sharedPlaces.update(place.fileId, changes);
  try {
    const token = await freshToken(place, save);
    const info = await fileInfo(token, place.fileId);
    if (info.trashed) throw new MissingFile();
    if (!force && place.contents && info.version === place.version) {
      await save({ checkedAt: Date.now(), lastError: undefined });
      return;
    }
    const file = await decodeSharedFile(await readDriveFile(token, place.fileId));
    if (!file) throw new BackupFailure('failed');
    await storeFile(place.fileId, info.version, file, database);
  } catch (error) {
    if (error instanceof MissingFile) {
      await endPlace(place.fileId, database);
      return;
    }
    await save({ checkedAt: Date.now(), lastError: error instanceof BackupFailure ? error.reason : 'failed' });
    return;
  }
  await cacheCovers(place.fileId, database);
}

let running: Promise<void> | undefined;

/** Updates the copies of the places shared with this person; one run at a time. Never throws. */
export function refreshSharedPlaces(database: LibraryDatabase = db): Promise<void> {
  running ??= (async () => {
    for (const place of await database.sharedPlaces.toArray()) {
      if (place.refreshToken && !place.endedAt) await refreshPlace(place, database);
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}

/** « Mettre à jour maintenant », on the screen of the place. */
export async function refreshPlaceNow(fileId: string, database: LibraryDatabase = db): Promise<void> {
  await running;
  const place = await database.sharedPlaces.get(fileId);
  if (place?.refreshToken) await refreshPlace(place, database, true);
}

// Decitre forbids reading its covers: shown by their address, online only, as on the owner's device.
const UNREADABLE_PROVIDERS = new Set(['decitre']);

/**
 * Downloads the automatic covers of the place, so that they show offline; one at a time, and only
 * those not yet kept. A cover that cannot be read stays shown by its address.
 */
export async function cacheCovers(fileId: string, database: LibraryDatabase = db, fetcher: typeof fetch = fetch): Promise<void> {
  const place = await database.sharedPlaces.get(fileId);
  if (!place?.contents) return;
  const kept = new Set(await database.sharedPhotos.where('fileId').equals(fileId).primaryKeys());
  for (const book of place.contents.books) {
    const { cover } = book;
    if (cover?.source !== 'auto' || !cover.url || coverPhotoId(cover) || UNREADABLE_PROVIDERS.has(cover.provider ?? '')) continue;
    const id = sharedPhotoKey(fileId, cover.url);
    if (kept.has(id)) continue;
    if (!navigator.onLine) return;
    try {
      const response = await fetcher(cover.url, { mode: 'cors' });
      const blob = response.ok ? await response.blob() : undefined;
      // The place may have been left meanwhile.
      if (blob?.type.startsWith('image/') && (await database.sharedPlaces.get(fileId))?.contents) {
        await database.sharedPhotos.put({ id, fileId, blob });
      }
    } catch {
      // A host that forbids reading its images: the cover is shown by its address.
    }
    kept.add(id);
  }
}

/**
 * « Ne plus consulter ce lieu »: the copy is erased from this device; the owner's file is untouched.
 * The access is not withdrawn from Google: it would also be for the other places of the same owner.
 */
export async function leaveSharedPlace(fileId: string, database: LibraryDatabase = db): Promise<void> {
  await database.transaction('rw', database.sharedPlaces, database.sharedPhotos, async () => {
    await database.sharedPhotos.where('fileId').equals(fileId).delete();
    await database.sharedPlaces.delete(fileId);
  });
}
