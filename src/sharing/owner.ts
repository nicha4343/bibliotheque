import {
  accessToken,
  addReader,
  BackupFailure,
  canShare,
  createDriveFile,
  deleteFile,
  driveUserName,
  getBackupState,
  listPermissions,
  MissingFile,
  removePermission,
  updateDriveFile,
} from '../backup/google';
import { db, type LibraryDatabase } from '../db/db';
import type { Id, ShareUpload, Site } from '../db/schema';
import { routeHref } from '../router';
import { compressImage } from '../scan/camera';
import { fr } from '../textes/fr';
import { sharedListUrl } from '../wishes/share';
import { encodeInvitation } from './invitation';
import {
  blobToBase64,
  contentsHash,
  encodeSharedFile,
  placeContents,
  SHARED_FORMAT,
  SHARED_MIME_TYPE,
  SHARED_VERSION,
  type LibraryRecords,
  type SharedFile,
} from './sharedFile';

// Lot 13, owner's side: a place shared with relatives lives in a file of the owner's Google Drive,
// created by the app (permission drive.file) and shared for reading with each relative. It is uploaded
// again, like the backup, when the place changed.

/** Photographs reduced for the guests: a cover on a phone screen needs no more. */
export type PhotoShrinker = (photo: Blob) => Promise<Blob>;

const shrinkPhoto: PhotoShrinker = async (photo) => {
  try {
    return await compressImage(photo, 640, 0.75);
  } catch {
    return photo;
  }
};

async function loadRecords(database: LibraryDatabase): Promise<LibraryRecords> {
  return database.transaction('r', [database.sites, database.rooms, database.shelves, database.books, database.copies], async () => ({
    sites: await database.sites.toArray(),
    rooms: await database.rooms.toArray(),
    shelves: await database.shelves.toArray(),
    books: await database.books.toArray(),
    copies: await database.copies.toArray(),
  }));
}

interface Built {
  file: SharedFile;
  hash: string;
}

async function buildFile(site: Site, owner: string, records: LibraryRecords, database: LibraryDatabase, shrink: PhotoShrinker): Promise<Built> {
  const built = placeContents(site.id, records);
  if (!built) throw new BackupFailure('failed');
  const photos = [];
  for (const id of built.photoIds) {
    const stored = await database.blobs.get(id);
    if (stored) photos.push({ id, data: await blobToBase64(await shrink(stored.blob)) });
  }
  return {
    file: { format: SHARED_FORMAT, version: SHARED_VERSION, createdAt: Date.now(), owner, ...built.contents, photos },
    hash: await contentsHash(owner, built.contents, built.photoIds),
  };
}

/** Shares a place: its file is created in the owner's Drive. Throws a BackupFailure. */
export async function sharePlace(siteId: Id, database: LibraryDatabase = db, shrink: PhotoShrinker = shrinkPhoto): Promise<void> {
  const token = await accessToken(database);
  const owner = await driveUserName(token);
  const records = await loadRecords(database);
  const site = records.sites.find((candidate) => candidate.id === siteId);
  if (!site) throw new BackupFailure('failed');
  const { file, hash } = await buildFile(site, owner, records, database, shrink);
  const fileId = await createDriveFile(
    token,
    { name: fr.sharing.fileName(site.name), description: fr.sharing.fileDescription, mimeType: SHARED_MIME_TYPE },
    await encodeSharedFile(file),
  );
  await database.transaction('rw', database.sites, database.shareUploads, async () => {
    await database.sites.update(siteId, { share: { fileId, owner, sharedAt: file.createdAt } });
    await database.shareUploads.put({ fileId, hash, uploadedAt: file.createdAt });
  });
}

const errorOf = (error: unknown): ShareUpload['lastError'] =>
  error instanceof MissingFile ? 'missing' : error instanceof BackupFailure ? error.reason : 'failed';

/** Uploads a shared place if it changed since its last upload (always when force). Never throws. */
async function uploadPlace(
  site: Site,
  records: LibraryRecords,
  database: LibraryDatabase,
  force: boolean,
  shrink: PhotoShrinker,
): Promise<boolean> {
  if (!site.share) return false;
  const { fileId, owner } = site.share;
  const upload = await database.shareUploads.get(fileId);
  try {
    const built = placeContents(site.id, records);
    if (!built) return false;
    if (!force && upload?.hash === (await contentsHash(owner, built.contents, built.photoIds))) return true;
    const token = await accessToken(database);
    const { file, hash } = await buildFile(site, owner, records, database, shrink);
    await updateDriveFile(token, fileId, fr.sharing.fileName(site.name), await encodeSharedFile(file));
    await database.shareUploads.put({ fileId, hash, uploadedAt: file.createdAt });
    return true;
  } catch (error) {
    await database.shareUploads.put({ ...upload, fileId, lastError: errorOf(error) });
    return false;
  }
}

let running: Promise<void> | undefined;

/** Uploads the shared places that changed; one run at a time. Never throws. */
export function uploadSharedPlaces(database: LibraryDatabase = db, shrink: PhotoShrinker = shrinkPhoto): Promise<void> {
  running ??= (async () => {
    if (!canShare(await getBackupState(database))) return;
    const records = await loadRecords(database);
    for (const site of records.sites) await uploadPlace(site, records, database, false, shrink);
  })().finally(() => {
    running = undefined;
  });
  return running;
}

/** « Mettre à jour maintenant »: uploads the place even if unchanged; false on failure (see shareUploads). */
export async function uploadPlaceNow(siteId: Id, database: LibraryDatabase = db, shrink: PhotoShrinker = shrinkPhoto): Promise<boolean> {
  await running;
  const records = await loadRecords(database);
  const site = records.sites.find((candidate) => candidate.id === siteId);
  return site ? uploadPlace(site, records, database, true, shrink) : false;
}

/** A relative the place is shared with. */
export interface Guest {
  permissionId: string;
  name: string;
  email: string;
}

/** The relatives the place is shared with, its owner aside. Throws a BackupFailure or MissingFile. */
export async function loadGuests(fileId: string, database: LibraryDatabase = db): Promise<Guest[]> {
  const permissions = await listPermissions(await accessToken(database), fileId);
  return permissions
    .filter((permission) => permission.role !== 'owner' && permission.type === 'user')
    .map((permission) => ({
      permissionId: permission.id,
      name: permission.displayName ?? '',
      email: permission.emailAddress ?? '',
    }));
}

/** Shares the place with a Google account. Throws a BackupFailure, MissingFile or UnknownAccount. */
export async function inviteGuest(fileId: string, email: string, database: LibraryDatabase = db): Promise<void> {
  await addReader(await accessToken(database), fileId, email.trim());
}

/** The relative no longer sees the place: their copy is erased at their next update. */
export async function removeGuest(fileId: string, permissionId: string, database: LibraryDatabase = db): Promise<void> {
  await removePermission(await accessToken(database), fileId, permissionId);
}

/** « Ne plus partager ce lieu »: its file is deleted from Drive; the guests' copies are erased at their next update. */
export async function stopSharing(siteId: Id, database: LibraryDatabase = db): Promise<void> {
  const site = await database.sites.get(siteId);
  if (!site?.share) return;
  const { fileId } = site.share;
  await deleteFile(await accessToken(database), fileId);
  await database.transaction('rw', database.sites, database.shareUploads, async () => {
    await database.sites.update(siteId, { share: undefined });
    await database.shareUploads.delete(fileId);
  });
}

/** The link to send to the relatives, holding the file and the owner's Google client. */
export async function invitationLink(site: Site, database: LibraryDatabase = db, appUrl = window.location.href): Promise<string> {
  const state = await getBackupState(database);
  if (!site.share || !state) return '';
  const payload = await encodeInvitation({
    fileId: site.share.fileId,
    place: site.name,
    owner: site.share.owner,
    clientId: state.clientId,
    clientSecret: state.clientSecret,
  });
  return sharedListUrl(appUrl, routeHref('invitation', payload));
}
