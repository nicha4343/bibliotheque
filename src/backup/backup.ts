import { db, type LibraryDatabase } from '../db/db';
import type { Id } from '../db/schema';
import {
  accessToken,
  BackupFailure,
  completeSignIn,
  deleteFile,
  downloadFile,
  getBackupState,
  listFiles,
  updateBackupState,
  uploadFile,
  type DriveFile,
  type SignInResult,
} from './google';
import { buildSnapshot, parseSnapshot, restoreSnapshot, snapshotHash, type Snapshot } from './snapshot';

// « Sauvegarde automatique » on Google Drive: one JSON file for the records, one file per photograph.
// Photographs never change (a new one gets a new id): each is uploaded once, and removed from Drive
// once the library no longer uses it.

export const SNAPSHOT_FILE = 'bibliotheque.json';
export const photoFileName = (blobId: Id): string => `photo-${blobId}.jpg`;
const PHOTO_FILE = /^photo-.+\.jpg$/;

let running: Promise<boolean> | undefined;

/**
 * Uploads the library if it changed since the last backup, or always when asked by the user. Never
 * throws: the outcome is kept in the backup state (lastBackupAt, lastError). One backup at a time.
 */
export function backUp({ force = false }: { force?: boolean } = {}, database: LibraryDatabase = db): Promise<boolean> {
  running ??= runBackup(force, database).finally(() => {
    running = undefined;
  });
  return running;
}

async function runBackup(force: boolean, database: LibraryDatabase): Promise<boolean> {
  const state = await getBackupState(database);
  if (!state?.refreshToken || (!state.enabled && !force)) return false;
  try {
    const snapshot = await buildSnapshot(database);
    const hash = await snapshotHash(snapshot);
    if (!force && hash === state.lastHash) return true;
    const token = await accessToken(database);
    const files = await listFiles(token);
    const onDrive = new Map(files.map((file) => [file.name, file.id]));
    // Photographs first: the records never refer to a photograph missing from Drive.
    for (const blobId of snapshot.blobIds) {
      if (onDrive.has(photoFileName(blobId))) continue;
      const stored = await database.blobs.get(blobId);
      if (stored) await uploadFile(token, photoFileName(blobId), stored.blob);
    }
    const json = new Blob([JSON.stringify(snapshot)], {
      type: 'application/json',
    });
    await uploadFile(token, SNAPSHOT_FILE, json, onDrive.get(SNAPSHOT_FILE));
    const used = new Set(snapshot.blobIds.map(photoFileName));
    for (const file of files) {
      if (PHOTO_FILE.test(file.name) && !used.has(file.name)) await deleteFile(token, file.id);
    }
    await updateBackupState(
      {
        lastBackupAt: snapshot.createdAt,
        lastHash: hash,
        lastError: undefined,
      },
      database,
    );
    return true;
  } catch (error) {
    await updateBackupState({ lastError: error instanceof BackupFailure ? error.reason : 'failed' }, database);
    return false;
  }
}

/** A backup found on Drive, read before the user confirms the restoration. */
export interface FoundBackup {
  snapshot: Snapshot;
  files: DriveFile[];
}

/** The backup kept on Drive, or undefined when there is none. Throws a BackupFailure. */
export async function findBackup(database: LibraryDatabase = db): Promise<FoundBackup | undefined> {
  const token = await accessToken(database);
  const files = await listFiles(token);
  const file = files.find((candidate) => candidate.name === SNAPSHOT_FILE);
  if (!file) return undefined;
  const snapshot = parseSnapshot(await (await downloadFile(token, file.id)).text());
  if (!snapshot) throw new BackupFailure('failed');
  return { snapshot, files };
}

/**
 * Replaces the library of this device with the backup. The missing photographs are downloaded first,
 * then everything is replaced at once: an interrupted restoration changes nothing.
 */
export async function restoreBackup(
  { snapshot, files }: FoundBackup,
  onProgress: (done: number, total: number) => void,
  database: LibraryDatabase = db,
): Promise<void> {
  const token = await accessToken(database);
  const onDrive = new Map(files.map((file) => [file.name, file.id]));
  const local = new Set(await database.blobs.toCollection().primaryKeys());
  const missing = snapshot.blobIds.filter((blobId) => !local.has(blobId) && onDrive.has(photoFileName(blobId)));
  onProgress(0, missing.length);
  for (const [index, blobId] of missing.entries()) {
    const blob = await downloadFile(token, onDrive.get(photoFileName(blobId)) ?? '');
    await database.blobs.put({ id: blobId, blob, createdAt: Date.now() });
    onProgress(index + 1, missing.length);
  }
  await restoreSnapshot(snapshot, database);
  // The library now matches the backup: nothing to upload.
  await updateBackupState(
    {
      lastBackupAt: snapshot.createdAt,
      lastHash: await snapshotHash(snapshot),
      lastError: undefined,
    },
    database,
  );
}

const FIRST_DELAY = 20_000;
const INTERVAL = 10 * 60_000;

let signIn: Promise<SignInResult> | undefined;

/** Outcome of the return from Google's sign-in page, given once to the backup screen. */
export function takeSignInResult(): Promise<SignInResult> | undefined {
  const result = signIn;
  signIn = undefined;
  return result;
}

/**
 * Called once at start-up, before the first rendering: completes a sign-in, then backs up shortly
 * after the start, every ten minutes and when the app is left (if the library changed).
 */
export function startBackups(): void {
  const run = () => {
    void backUp();
  };
  if (new URLSearchParams(window.location.search).has('state')) {
    signIn = completeSignIn();
    void signIn.then((result) => {
      if (result === 'connected') run();
    });
  }
  window.setTimeout(run, FIRST_DELAY);
  window.setInterval(run, INTERVAL);
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run();
  });
}
