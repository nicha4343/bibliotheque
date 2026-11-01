import { db, type LibraryDatabase } from '../db/db';
import type { BackupError, BackupState } from '../db/schema';

// Google sign-in (authorization code with PKCE, which yields a refresh token: backups then run without
// any further sign-in) and the few Drive calls the backup needs. No Google script is loaded.

/** Hidden folder of the user's Drive, reserved for the app: it sees nothing else. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
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

/** Leaves the app for Google's sign-in page; completeSignIn takes over on return. */
export async function startSignIn(database: LibraryDatabase = db): Promise<void> {
  const state = await getBackupState(database);
  if (!state) return;
  const pendingSignIn = { verifier: randomString(), state: randomString() };
  await updateBackupState({ pendingSignIn }, database);
  const params = new URLSearchParams({
    client_id: state.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    // Always asked, so that Google gives a refresh token again after a disconnection.
    prompt: 'consent',
    code_challenge: await challengeOf(pendingSignIn.verifier),
    code_challenge_method: 'S256',
    state: pendingSignIn.state,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function requestToken(fields: Record<string, string>, state: BackupState): Promise<TokenResponse> {
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

/**
 * On return from Google's page (?code=…&state=… in the address): exchanges the code for the tokens.
 * The address is cleaned at once, before the first rendering, and leads to the backup screen.
 */
export async function completeSignIn(database: LibraryDatabase = db): Promise<SignInResult> {
  const params = new URLSearchParams(window.location.search);
  const returned = params.get('state');
  const code = params.get('code');
  if (!returned || (!code && !params.has('error'))) return 'none';
  window.history.replaceState(null, '', `${redirectUri()}#/sauvegarde`);

  const state = await getBackupState(database);
  if (!state?.pendingSignIn || state.pendingSignIn.state !== returned) return 'failed';
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

/** A valid access token, renewed with the refresh token when it is about to expire (one hour). */
export async function accessToken(database: LibraryDatabase = db): Promise<string> {
  const state = await getBackupState(database);
  if (!state?.refreshToken) throw new BackupFailure('refused');
  if (state.accessToken && (state.accessTokenExpiresAt ?? 0) > Date.now() + 60_000) return state.accessToken;
  const tokens = await requestToken({ grant_type: 'refresh_token', refresh_token: state.refreshToken }, state);
  await updateBackupState(
    {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    },
    database,
  );
  return tokens.access_token;
}

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

async function driveCall(token: string, url: string, init: RequestInit = {}, allowMissing = false): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new BackupFailure('offline');
  }
  if (response.status === 401) throw new BackupFailure('refused');
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
