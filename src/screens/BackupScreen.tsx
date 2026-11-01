import { useEffect, useState } from 'preact/hooks';
import { backUp, findBackup, restoreBackup, takeSignInResult, type FoundBackup } from '../backup/backup';
import {
  BackupFailure,
  disconnect,
  getBackupState,
  redirectUri,
  saveClient,
  startSignIn,
  updateBackupState,
  type SignInResult,
} from '../backup/google';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ChevronLeftIcon, CloseIcon, DownloadIcon, UploadIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { SwitchRow } from '../components/SwitchRow';
import { db } from '../db/db';
import type { BackupError, BackupState } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { routeHref } from '../router';
import { formatDateTime, fr } from '../textes/fr';

const SIGN_IN_TEXTS: Record<SignInResult, string> = {
  none: '',
  connected: fr.backup.connected,
  cancelled: fr.backup.cancelled,
  missingScope: fr.backup.missingScope,
  failed: fr.backup.signInFailed,
};

const ERROR_TEXTS: Record<BackupError, string> = {
  offline: fr.backup.errorOffline,
  refused: fr.backup.errorRefused,
  failed: fr.backup.errorFailed,
};

const CLIENT_ID_END = '.apps.googleusercontent.com';

interface BackupData {
  state: BackupState | undefined;
  books: number;
}

/** « Sauvegarde sur Google Drive » (lot 2): Google client, sign-in, automatic backup and restoration. */
export function BackupScreen() {
  const data = useLiveQuery<BackupData | undefined>(
    async () => ({
      state: await getBackupState(),
      books: await db.books.count(),
    }),
    [],
    undefined,
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [found, setFound] = useState<FoundBackup>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Return from Google's sign-in page.
  useEffect(() => {
    const result = takeSignInResult();
    if (!result) return;
    setMessage(fr.backup.connecting);
    void result.then((value) => {
      setMessage(SIGN_IN_TEXTS[value]);
    });
  }, []);

  if (!data) return <main class="screen" />;
  const { state, books } = data;
  const connected = Boolean(state?.refreshToken);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const backUpNow = () =>
    run(async () => {
      setMessage(fr.backup.backingUp);
      const done = await backUp({ force: true });
      const error = (await getBackupState())?.lastError;
      setMessage(done ? fr.backup.backedUp : ERROR_TEXTS[error ?? 'failed']);
    });

  const searchBackup = () =>
    run(async () => {
      setMessage(fr.backup.searching);
      try {
        const backup = await findBackup();
        setMessage(backup ? '' : fr.backup.noBackup);
        setFound(backup);
      } catch (error) {
        setMessage(ERROR_TEXTS[error instanceof BackupFailure ? error.reason : 'failed']);
      }
    });

  const restore = (backup: FoundBackup) =>
    run(async () => {
      setFound(undefined);
      try {
        await restoreBackup(backup, (done, total) => {
          setMessage(fr.backup.restoring(done, total));
        });
        setMessage(fr.backup.restored);
      } catch (error) {
        setMessage(
          error instanceof BackupFailure && error.reason === 'offline' ? fr.backup.errorOffline : fr.backup.restoreFailed,
        );
      }
    });

  return (
    <Screen title={fr.backup.title}>
      <div class="back-bar">
        <a class="text-button back-bar__link" href={routeHref('settings')}>
          <ChevronLeftIcon size={20} />
          {fr.backup.back}
        </a>
      </div>
      <p class="screen__intro">{fr.backup.intro}</p>
      <p class="status-line" role="status">
        {message}
      </p>

      {!state || editingClient ? (
        <ClientForm
          state={state}
          onCancel={
            state
              ? () => {
                  setEditingClient(false);
                }
              : undefined
          }
        />
      ) : connected ? (
        <>
          <section class="section" aria-labelledby="backup-status-title">
            <h2 class="section__title" id="backup-status-title">
              {fr.backup.status}
            </h2>
            <div class="card">
              <SwitchRow
                label={fr.backup.auto}
                detail={fr.backup.autoDetail}
                checked={state.enabled}
                onChange={(enabled) => {
                  void updateBackupState({ enabled });
                }}
              />
              <div class="card__row backup__last">
                <p class="card__label">
                  {state.lastBackupAt
                    ? fr.backup.last(formatDateTime(new Date(state.lastBackupAt), new Date()))
                    : fr.backup.never}
                </p>
                {state.lastError && <p class="card__value backup__error">{ERROR_TEXTS[state.lastError]}</p>}
              </div>
            </div>
          </section>
          <div class="backup__actions">
            {state.lastError === 'refused' && (
              <button
                type="button"
                class="button button--primary button--large"
                disabled={busy}
                onClick={() => void startSignIn()}
              >
                {fr.backup.reconnect}
              </button>
            )}
            <button type="button" class="button button--primary button--large" disabled={busy} onClick={() => void backUpNow()}>
              <UploadIcon size={20} />
              {fr.backup.backUpNow}
            </button>
            <button
              type="button"
              class="button button--secondary button--large"
              disabled={busy}
              onClick={() => void searchBackup()}
            >
              <DownloadIcon size={20} />
              {fr.backup.restore}
            </button>
            <button
              type="button"
              class="button button--secondary button--large"
              disabled={busy}
              onClick={() => {
                setConfirmDisconnect(true);
              }}
            >
              {fr.backup.disconnect}
            </button>
          </div>
        </>
      ) : (
        <div class="backup__actions">
          <button type="button" class="button button--primary button--large" onClick={() => void startSignIn()}>
            {fr.backup.connect}
          </button>
          <button
            type="button"
            class="button button--secondary button--large"
            onClick={() => {
              setEditingClient(true);
            }}
          >
            {fr.backup.editClient}
          </button>
        </div>
      )}

      {found && (
        <ConfirmSheet
          title={fr.backup.restoreTitle}
          text={fr.backup.restoreText(formatDateTime(new Date(found.snapshot.createdAt)), found.snapshot.books.length, books)}
          confirm={fr.backup.restoreConfirm}
          icon={<DownloadIcon size={18} />}
          onConfirm={() => void restore(found)}
          onClose={() => {
            setFound(undefined);
          }}
        />
      )}
      {confirmDisconnect && (
        <ConfirmSheet
          title={fr.backup.disconnectTitle}
          text={fr.backup.disconnectText}
          confirm={fr.backup.disconnectConfirm}
          icon={<CloseIcon size={18} />}
          onConfirm={() => {
            setConfirmDisconnect(false);
            void disconnect().then(() => {
              setMessage(fr.backup.disconnected);
            });
          }}
          onClose={() => {
            setConfirmDisconnect(false);
          }}
        />
      )}
    </Screen>
  );
}

/** The Google client created by the user; saving it leads to Google's sign-in page. */
function ClientForm({ state, onCancel }: { state: BackupState | undefined; onCancel: (() => void) | undefined }) {
  const [clientId, setClientId] = useState(state?.clientId ?? '');
  const [secret, setSecret] = useState(state?.clientSecret ?? '');
  const [submitted, setSubmitted] = useState(false);
  const idInvalid = !clientId.trim().endsWith(CLIENT_ID_END);
  const secretMissing = !secret.trim();

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (idInvalid || secretMissing) return;
    await saveClient(clientId.trim(), secret.trim());
    await startSignIn();
  };

  return (
    <section class="section" aria-labelledby="client-title">
      <h2 class="section__title" id="client-title">
        {fr.backup.clientTitle}
      </h2>
      <form class="card book-card" onSubmit={(event) => void submit(event)} noValidate>
        <p class="field__hint">{fr.backup.clientIntro}</p>
        <div class="field">
          <label class="field__label" for="client-id">
            {fr.backup.clientId}
          </label>
          <input
            id="client-id"
            class="field__input mono"
            type="text"
            value={clientId}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            aria-invalid={submitted && idInvalid}
            onInput={(event) => {
              setClientId(event.currentTarget.value);
            }}
          />
          {submitted && idInvalid && <p class="field__error">{fr.backup.clientIdInvalid}</p>}
        </div>
        <div class="field">
          <label class="field__label" for="client-secret">
            {fr.backup.clientSecret}
          </label>
          <input
            id="client-secret"
            class="field__input mono"
            type="password"
            value={secret}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            aria-invalid={submitted && secretMissing}
            onInput={(event) => {
              setSecret(event.currentTarget.value);
            }}
          />
          {submitted && secretMissing && <p class="field__error">{fr.backup.clientSecretMissing}</p>}
        </div>
        <div class="field">
          <span class="field__label">{fr.backup.redirect}</span>
          <span class="mono backup__redirect">{redirectUri()}</span>
        </div>
        <button type="submit" class="button button--primary button--large">
          {fr.backup.connect}
        </button>
        {onCancel && (
          <button type="button" class="button button--secondary button--large" onClick={onCancel}>
            {fr.common.cancel}
          </button>
        )}
      </form>
    </section>
  );
}
