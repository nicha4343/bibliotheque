import { useEffect, useState } from 'preact/hooks';
import { BackupFailure, canShare, getBackupState, MissingFile, startSignIn, UnknownAccount } from '../backup/google';
import { BackLink } from '../components/BackLink';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { CloseIcon, UploadIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { BackupState, ShareUpload, Site } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { routeHref } from '../router';
import { invitationLink, inviteGuest, loadGuests, removeGuest, sharePlace, stopSharing, uploadPlaceNow, type Guest } from '../sharing/owner';
import { formatDateTime, fr } from '../textes/fr';
import { SharingNeeds, useAllowResult } from './SharingScreen';

interface SiteSharingData {
  site: Site | undefined;
  state: BackupState | undefined;
  upload: ShareUpload | undefined;
}

const UPLOAD_ERRORS: Record<NonNullable<ShareUpload['lastError']>, string> = {
  offline: fr.sharing.errorOffline,
  refused: fr.sharing.errorRefused,
  failed: fr.sharing.errorFailed,
  missing: fr.sharing.errorMissing,
};

/** Text of a failed operation. */
function failureText(error: unknown): string {
  if (error instanceof UnknownAccount) return fr.sharing.unknownAccount;
  if (error instanceof MissingFile) return fr.sharing.errorMissing;
  if (error instanceof BackupFailure && error.reason === 'offline') return fr.sharing.offline;
  if (error instanceof BackupFailure && error.reason === 'refused') return fr.sharing.refused;
  return fr.sharing.failed;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** « Partager « Maison de campagne » » (lot 13): the file of the place, the relatives invited, the link to send them. */
export function SiteSharingScreen({ siteId }: { siteId: string }) {
  const data = useLiveQuery<SiteSharingData | undefined>(
    async () => {
      const site = await db.sites.get(siteId);
      return {
        site,
        state: await getBackupState(),
        upload: site?.share ? await db.shareUploads.get(site.share.fileId) : undefined,
      };
    },
    [siteId],
    undefined,
  );
  const allowMessage = useAllowResult();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  if (!data) return <main class="screen" />;
  const { site, state, upload } = data;
  const back = <BackLink href={routeHref('sharing')} label={fr.sharing.siteBack} />;
  if (!site) {
    return (
      <Screen title={fr.sharing.title}>
        {back}
        <p class="screen__intro">{fr.sharing.notFound}</p>
      </Screen>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={fr.sharing.siteTitle(site.name)}>
      {back}
      <p class="screen__intro">{fr.sharing.siteIntro(site.name)}</p>
      <p class="status-line" role="status">
        {message || allowMessage}
      </p>

      {!canShare(state) ? (
        <SharingNeeds state={state} returnTo={routeHref('sharing', siteId)} />
      ) : !site.share ? (
        <div class="backup__actions">
          <p class="screen__intro">{fr.sharing.siteHow}</p>
          <button
            type="button"
            class="button button--primary button--large"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setMessage(fr.sharing.sharing);
                await sharePlace(siteId);
                setMessage(fr.sharing.shared);
              })
            }
          >
            {fr.sharing.share}
          </button>
        </div>
      ) : (
        <>
          <section class="section" aria-labelledby="share-status-title">
            <h2 class="section__title" id="share-status-title">
              {fr.sharing.status}
            </h2>
            <div class="card">
              <div class="card__row backup__last">
                <p class="card__label">
                  {upload?.uploadedAt ? fr.sharing.uploaded(formatDateTime(new Date(upload.uploadedAt), new Date())) : fr.sharing.neverUploaded}
                </p>
                <p class="card__value">{upload?.lastError ? UPLOAD_ERRORS[upload.lastError] : fr.sharing.autoDetail}</p>
              </div>
            </div>
            {upload?.lastError === 'refused' && (
              <button
                type="button"
                class="button button--primary button--large"
                disabled={busy}
                onClick={() => void startSignIn(db, routeHref('sharing', siteId))}
              >
                {fr.sharing.reconnect}
              </button>
            )}
            <button
              type="button"
              class="button button--secondary button--large"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setMessage(fr.sharing.updating);
                  const done = await uploadPlaceNow(siteId);
                  const error = (await db.shareUploads.get(site.share?.fileId ?? ''))?.lastError;
                  setMessage(done ? fr.sharing.updated : error ? UPLOAD_ERRORS[error] : fr.sharing.failed);
                })
              }
            >
              <UploadIcon size={20} />
              {fr.sharing.updateNow}
            </button>
          </section>

          <Guests site={site} fileId={site.share.fileId} busy={busy} run={run} setMessage={setMessage} />

          <button
            type="button"
            class="button button--danger button--large"
            disabled={busy}
            onClick={() => {
              setConfirmStop(true);
            }}
          >
            {fr.sharing.stop}
          </button>
        </>
      )}

      {confirmStop && (
        <ConfirmSheet
          title={fr.sharing.stopTitle}
          text={fr.sharing.stopText(site.name)}
          confirm={fr.sharing.stopConfirm}
          icon={<CloseIcon size={18} />}
          onConfirm={() => {
            setConfirmStop(false);
            void run(async () => {
              await stopSharing(siteId);
              setMessage(fr.sharing.stopped);
            });
          }}
          onClose={() => {
            setConfirmStop(false);
          }}
        />
      )}
    </Screen>
  );
}

type GuestList = Guest[] | 'loading' | 'offline' | 'failed';

interface GuestsProps {
  site: Site;
  fileId: string;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string) => void;
}

/** The relatives the place is shared with, read from Drive; adding one, removing one, sending the link. */
function Guests({ site, fileId, busy, run, setMessage }: GuestsProps) {
  const [guests, setGuests] = useState<GuestList>('loading');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [removing, setRemoving] = useState<Guest>();
  const [link, setLink] = useState<string>();
  const emailInvalid = !EMAIL.test(email.trim());

  const reload = async () => {
    try {
      setGuests(await loadGuests(fileId));
    } catch (error) {
      setGuests(error instanceof BackupFailure && error.reason === 'offline' ? 'offline' : 'failed');
    }
  };

  useEffect(() => {
    void reload();
    // Prepared beforehand: the share sheet of the phone opens only right after a touch.
    void invitationLink(site).then(setLink);
    // Read again when the file or the name of the place changes.
  }, [fileId, site.name]);

  const invite = (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (emailInvalid) return;
    void run(async () => {
      setMessage(fr.sharing.inviting);
      await inviteGuest(fileId, email);
      setMessage(fr.sharing.invited(email.trim()));
      setEmail('');
      setSubmitted(false);
      await reload();
    });
  };

  const sendLink = () => {
    if (!link) return;
    const owner = site.share?.owner || fr.sharing.someone;
    if (typeof navigator.share === 'function') {
      navigator.share({ title: fr.sharing.shareTitle(site.name), text: fr.sharing.shareText(owner, site.name), url: link }).catch(() => undefined);
      return;
    }
    navigator.clipboard.writeText(`${fr.sharing.shareText(owner, site.name)} ${link}`).then(
      () => {
        setMessage(fr.sharing.linkCopied);
      },
      () => {
        setMessage(fr.sharing.linkFailed);
      },
    );
  };

  return (
    <section class="section" aria-labelledby="guests-title">
      <h2 class="section__title" id="guests-title">
        {fr.sharing.guests}
      </h2>
      <div class="card">
        {typeof guests === 'string' ? (
          <p class="card__row card__label">
            {guests === 'loading' ? fr.sharing.guestsLoading : guests === 'offline' ? fr.sharing.guestsOffline : fr.sharing.guestsFailed}
          </p>
        ) : guests.length === 0 ? (
          <p class="card__row card__label">{fr.sharing.noGuests}</p>
        ) : (
          <ul class="guest-list">
            {guests.map((guest) => (
              <li key={guest.permissionId} class="guest">
                <span class="guest__text">
                  <span class="guest__name">{guest.name || guest.email}</span>
                  {guest.name && <span class="guest__email">{guest.email}</span>}
                </span>
                <button
                  type="button"
                  class="text-button"
                  disabled={busy}
                  aria-label={fr.sharing.removeLabel(guest.name || guest.email)}
                  onClick={() => {
                    setRemoving(guest);
                  }}
                >
                  {fr.sharing.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form class="card book-card" onSubmit={invite} noValidate>
        <div class="field">
          <label class="field__label" for="guest-email">
            {fr.sharing.emailLabel}
          </label>
          <input
            id="guest-email"
            class="field__input"
            type="email"
            inputMode="email"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            value={email}
            placeholder={fr.sharing.emailPlaceholder}
            aria-invalid={submitted && emailInvalid}
            onInput={(event) => {
              setEmail(event.currentTarget.value);
            }}
          />
          {submitted && emailInvalid && <p class="field__error">{fr.sharing.emailInvalid}</p>}
        </div>
        <button type="submit" class="button button--primary button--large" disabled={busy}>
          {fr.sharing.invite}
        </button>
      </form>

      <button type="button" class="button button--secondary button--large" disabled={!link} onClick={sendLink}>
        {fr.sharing.sendLink}
      </button>
      <p class="field__hint">{fr.sharing.linkHint}</p>

      {removing && (
        <ConfirmSheet
          title={fr.sharing.removeTitle}
          text={fr.sharing.removeText(removing.name || removing.email, site.name)}
          confirm={fr.sharing.remove}
          icon={<CloseIcon size={18} />}
          onConfirm={() => {
            const guest = removing;
            setRemoving(undefined);
            void run(async () => {
              await removeGuest(fileId, guest.permissionId);
              setMessage(fr.sharing.removed(guest.name || guest.email));
              await reload();
            });
          }}
          onClose={() => {
            setRemoving(undefined);
          }}
        />
      )}
    </section>
  );
}
