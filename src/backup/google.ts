import { db, type LibraryDatabase } from '../db/db';
import type { BackupError, BackupState } from '../db/schema';

// Google sign-in (authorization code with PKCE, which yields a refresh token: backups then run without
// any further sign-in) and the few Drive calls the backup and the shared places need. No Google script
// is loaded.

/** Hidden folder of the user's Drive, reserved for the app: it sees nothing else. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/**
 * Lot 13: the files the app created (the shared places of the owner) or that the user picked in Google's
 * file picker (a place shared with them); never the rest of the Drive.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

export class BackupFailure extends Error {
  readonly reason: BackupError;

  constructor(reason: BackupError) {
    super(reason);
    this.reason = reason;
  }
}

export const getBackupState = (database: LibraryDatabase = db): Promise<BackupState | undefined> => database.backup.get('drive');

export async function updateBackupState(
  changes: Partial<Omit<BackupState, 'id'>>,
  database: LibraryDatabase = db,
): Promise<void> {
  await database.backup.update('drive', changes);
}

/** The client created by the user; another client means another sign-in. */
export async function saveClient(clientId: string, clientSecret: string, database: LibraryDatabase = db): Promise<void> {
  const current = await getBackupState(database);
  if (current?.clientId === clientId && current.clientSecret === clientSecret) return;
  await database.backup.put({
    id: 'drive',
    clientId,
    clientSecret,
    enabled: true,
  });
}

/** Address Google sends the user back to, to be declared as such in the Google Cloud console. */
export function redirectUri(location: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = (): string => base64Url(crypto.getRandomValues(new Uint8Array(32)));

async function challengeOf(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** PKCE verifier and state of a sign-in about to start. */
export const newPendingSignIn = (): { verifier: string; state: string } => ({ verifier: randomString(), state: randomString() });

/** Google's page: sign-in and consent, with the PKCE challenge; extra parameters open the file picker. */
export async function authorizationUrl(
  clientId: string,
  scope: string,
  pending: { verifier: string; state: string },
  extra: Record<string, string> = {},
): Promise<string> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope,
    access_type: 'offline',
    // Always asked, so that Google gives a refresh token again after a disconnection.
    prompt: 'consent',
    code_challenge: await challengeOf(pending.verifier),
    code_challenge_method: 'S256',
    state: pending.state,
    ...extra,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// The screen to show on return from Google's page, known before the first rendering (the database is
// read later): kept on the device with the state of the sign-in.
const RETURN_KEY = 'bibliotheque.retourGoogle';
const BACKUP_HASH = '#/sauvegarde';

/** Leaves the app for Google's page; the screen given is shown on return. */
export function goToGoogle(url: string, state: string, returnTo: string): void {
  try {
    localStorage.setItem(RETURN_KEY, JSON.stringify({ state, hash: returnTo }));
  } catch {
    // Storage refused: the backup screen is shown on return, and the screen of a shared place later.
  }
  window.location.assign(url);
}

/**
 * Leaves the app for Google's sign-in page; completeSignIn takes over on return, then shows the screen
 * given (the backup screen by default). Both permissions are asked at once: the backup and the shared
 * places (lot 13).
 */
export async function startSignIn(database: LibraryDatabase = db, returnTo = BACKUP_HASH): Promise<void> {
  const state = await getBackupState(database);
  if (!state) return;
  const pendingSignIn = newPendingSignIn();
  await updateBackupState({ pendingSignIn }, database);
  goToGoogle(await authorizationUrl(state.clientId, `${DRIVE_SCOPE} ${DRIVE_FILE_SCOPE}`, pendingSignIn), pendingSignIn.state, returnTo);
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** A Google client created by a user: theirs, or that of the relative who shares a place with them. */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export async function requestToken(fields: Record<string, string>, state: GoogleClient): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...fields,
        client_id: state.clientId,
        client_secret: state.clientSecret,
      }),
    });
  } catch {
    throw new BackupFailure('offline');
  }
  // invalid_grant (access revoked or expired), invalid_client (wrong secret).
  if (response.status === 400 || response.status === 401) throw new BackupFailure('refused');
  if (!response.ok) throw new BackupFailure('failed');
  return (await response.json()) as TokenResponse;
}

export type SignInResult = 'none' | 'connected' | 'cancelled' | 'missingScope' | 'failed';

/** What Google appends to the address on return from its page: no code when the user cancelled. */
export interface GoogleReturn {
  state: string;
  code?: string;
  /** Files chosen in Google's file picker (lot 13). */
  pickedFileIds: string[];
}

/**
 * On return from Google's page (?code=…&state=… in the address): the parameters, removed from the
 * address at once, before the first rendering, which shows the screen the sign-in was started from.
 */
export function takeGoogleReturn(): GoogleReturn | undefined {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const code = params.get('code');
  if (!state || (!code && !params.has('error'))) return undefined;
  let hash = BACKUP_HASH;
  try {
    const kept = JSON.parse(localStorage.getItem(RETURN_KEY) ?? 'null') as { state?: unknown; hash?: unknown } | null;
    if (kept?.state === state && typeof kept.hash === 'string') hash = kept.hash;
    localStorage.removeItem(RETURN_KEY);
  } catch {
    // Storage refused: the backup screen.
  }
  window.history.replaceState(null, '', `${redirectUri()}${hash}`);
  const picked = params.get('picked_file_ids');
  return { state, ...(code ? { code } : {}), pickedFileIds: picked ? picked.split(',') : [] };
}

/**
 * Exchanges the code Google returned for the tokens of the user's own connection; 'none' when the
 * sign-in was not theirs (a place shared with them, lot 13).
 */
export async function completeSignIn(returned: GoogleReturn, database: LibraryDatabase = db): Promise<SignInResult> {
  const state = await getBackupState(database);
  if (!state?.pendingSignIn || state.pendingSignIn.state !== returned.state) return 'none';
  const { code } = returned;
  const { verifier } = state.pendingSignIn;
  await updateBackupState({ pendingSignIn: undefined }, database);
  if (!code) return 'cancelled';
  try {
    const tokens = await requestToken(
      {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri(),
      },
      state,
    );
    // Google lets the user untick the Drive permission.
    if (!tokens.scope?.split(' ').includes(DRIVE_SCOPE)) return 'missingScope';
    if (!tokens.refresh_token) return 'failed';
    await updateBackupState(
      {
        scopes: tokens.scope.split(' '),
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        enabled: true,
        lastError: undefined,
      },
      database,
    );
    return 'connected';
  } catch {
    return 'failed';
  }
}

/** Tokens kept on the device: the refresh token, and the access token while it is valid. */
export interface StoredTokens extends GoogleClient {
  refreshToken?: string | undefined;
  accessToken?: string | undefined;
  accessTokenExpiresAt?: number | undefined;
}

/**
 * A valid access token, renewed with the refresh token when it is about to expire (one hour); save
 * keeps the new one.
 */
export async function freshToken(
  stored: StoredTokens | undefined,
  save: (changes: { accessToken: string; accessTokenExpiresAt: number }) => Promise<unknown>,
): Promise<string> {
  if (!stored?.refreshToken) throw new BackupFailure('refused');
  if (stored.accessToken && (stored.accessTokenExpiresAt ?? 0) > Date.now() + 60_000) return stored.accessToken;
  const tokens = await requestToken({ grant_type: 'refresh_token', refresh_token: stored.refreshToken }, stored);
  await save({ accessToken: tokens.access_token, accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000 });
  return tokens.access_token;
}

/** A valid access token of the user's own connection (backup, and the places they share). */
export async function accessToken(database: LibraryDatabase = db): Promise<string> {
  return freshToken(await getBackupState(database), (changes) => updateBackupState(changes, database));
}

/** The user allowed the app to create the files of the places they share (lot 13). */
export const canShare = (state: BackupState | undefined): boolean =>
  Boolean(state?.refreshToken && state.scopes?.includes(DRIVE_FILE_SCOPE));

/** The access is withdrawn from Google too; the backups already made stay on Drive. */
export async function disconnect(database: LibraryDatabase = db): Promise<void> {
  const state = await getBackupState(database);
  if (state?.refreshToken) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: state.refreshToken }),
      });
    } catch {
      // Offline: the access stays granted on Google's side, unused.
    }
  }
  await updateBackupState(
    {
      refreshToken: undefined,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      scopes: undefined,
      lastBackupAt: undefined,
      lastHash: undefined,
      lastError: undefined,
    },
    database,
  );
}

// Drive (version 3), in the hidden application folder.

export interface DriveFile {
  id: string;
  name: string;
}

/** Drive answered that the file does not exist, or no longer for this person (lot 13). */
export class MissingFile extends Error {
  constructor() {
    super('missing');
  }
}

async function driveCall(
  token: string,
  url: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  allowMissing = false,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new BackupFailure('offline');
  }
  if (response.status === 401) throw new BackupFailure('refused');
  if (response.status === 404 && !allowMissing) throw new MissingFile();
  if (!response.ok && !(allowMissing && response.status === 404)) throw new BackupFailure('failed');
  return response;
}

export async function listFiles(token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'nextPageToken,files(id,name)',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = (await (await driveCall(token, `${FILES_URL}?${params.toString()}`)).json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

/** Creates the file, or replaces the contents of an existing one. */
export async function uploadFile(token: string, name: string, content: Blob, fileId?: string): Promise<void> {
  const form = new FormData();
  const metadata = fileId ? {} : { name, parents: ['appDataFolder'] };
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', content);
  const url = fileId ? `${UPLOAD_URL}/${fileId}?uploadType=multipart&fields=id` : `${UPLOAD_URL}?uploadType=multipart&fields=id`;
  await driveCall(token, url, {
    method: fileId ? 'PATCH' : 'POST',
    body: form,
  });
}

export async function downloadFile(token: string, fileId: string): Promise<Blob> {
  return (await driveCall(token, `${FILES_URL}/${fileId}?alt=media`)).blob();
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  await driveCall(token, `${FILES_URL}/${fileId}`, { method: 'DELETE' }, true);
}

// Lot 13: the file of a shared place, in the owner's Drive (outside the hidden folder, so that it can be
// shared), and the people it is shared with.

/**
 * Resumable upload (a shared place with its photographs may exceed the 5 Mo of a multipart upload):
 * the metadata first, then the contents to the address Drive gives. Returns the id of the file.
 */
async function resumableUpload(token: string, url: string, method: 'POST' | 'PATCH', metadata: object, content: Blob): Promise<string> {
  const start = await driveCall(token, url, {
    method,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': content.type },
    body: JSON.stringify(metadata),
  });
  const session = start.headers.get('Location');
  if (!session) throw new BackupFailure('failed');
  const done = await driveCall(token, session, { method: 'PUT', body: content });
  return ((await done.json()) as { id: string }).id;
}

/** Creates a file at the root of the owner's Drive; returns its id. */
export async function createDriveFile(
  token: string,
  metadata: { name: string; description: string; mimeType: string },
  content: Blob,
): Promise<string> {
  return resumableUpload(token, `${UPLOAD_URL}?uploadType=resumable&fields=id`, 'POST', metadata, content);
}

/** Replaces the contents of a file, and its name (the place may have been renamed). Throws MissingFile. */
export async function updateDriveFile(token: string, fileId: string, name: string, content: Blob): Promise<void> {
  await resumableUpload(token, `${UPLOAD_URL}/${fileId}?uploadType=resumable&fields=id`, 'PATCH', { name }, content);
}

export interface DriveFileInfo {
  id: string;
  name: string;
  version: string;
  trashed?: boolean;
}

/** Name and version of a file. Throws MissingFile when the person no longer has access to it. */
export async function fileInfo(token: string, fileId: string): Promise<DriveFileInfo> {
  return (await (await driveCall(token, `${FILES_URL}/${fileId}?fields=id,name,version,trashed`)).json()) as DriveFileInfo;
}

/** Contents of a file. Throws MissingFile. */
export async function readDriveFile(token: string, fileId: string): Promise<Blob> {
  return (await driveCall(token, `${FILES_URL}/${fileId}?alt=media`)).blob();
}

export interface DrivePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  displayName?: string;
}

/** The people a file is shared with, its owner included. Throws MissingFile. */
export async function listPermissions(token: string, fileId: string): Promise<DrivePermission[]> {
  const params = new URLSearchParams({ fields: 'permissions(id,type,role,emailAddress,displayName)' });
  const response = await driveCall(token, `${FILES_URL}/${fileId}/permissions?${params.toString()}`);
  return ((await response.json()) as { permissions?: DrivePermission[] }).permissions ?? [];
}

/** No Google account answers to this address: Drive then refuses to share without its own email. */
export class UnknownAccount extends Error {
  constructor() {
    super('unknownAccount');
  }
}

/** Shares the file for reading with a Google account, without Google's email: the app sends its own link. */
export async function addReader(token: string, fileId: string, emailAddress: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${FILES_URL}/${fileId}/permissions?sendNotificationEmail=false&fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'reader', emailAddress }),
    });
  } catch {
    throw new BackupFailure('offline');
  }
  if (response.status === 400) throw new UnknownAccount();
  if (response.status === 401) throw new BackupFailure('refused');
  if (response.status === 404) throw new MissingFile();
  if (!response.ok) throw new BackupFailure('failed');
}

export async function removePermission(token: string, fileId: string, permissionId: string): Promise<void> {
  await driveCall(token, `${FILES_URL}/${fileId}/permissions/${permissionId}`, { method: 'DELETE' }, true);
}

/** Name of the person signed in, shown to the relatives they invite. */
export async function driveUserName(token: string): Promise<string> {
  const response = await driveCall(token, 'https://www.googleapis.com/drive/v3/about?fields=user(displayName)');
  return ((await response.json()) as { user?: { displayName?: string } }).user?.displayName ?? '';
}
