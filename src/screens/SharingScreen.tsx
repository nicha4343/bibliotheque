import { useEffect, useState } from 'preact/hooks';
import { takeSignInResult } from '../backup/backup';
import { canShare, getBackupState, startSignIn, type SignInResult } from '../backup/google';
import { BackLink } from '../components/BackLink';
import { ChevronRightIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { BackupState, SharedPlace, Site } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { sortByOrder } from '../places/places';
import { ROUTE_HASHES, routeHref } from '../router';
import { loadSharedPlaces } from '../sharing/sharedLibrary';
import { formatDate, fr } from '../textes/fr';

interface SharingData {
  state: BackupState | undefined;
  sites: Site[];
  withYou: SharedPlace[];
}

/** Message shown on return from Google, when the user allowed the sharing from a screen of lot 13. */
export function useAllowResult(): string {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const result = takeSignInResult();
    if (!result) return;
    setMessage(fr.sharing.allowing);
    void Promise.all([result, getBackupState()]).then(([value, state]: [SignInResult, BackupState | undefined]) => {
      if (value === 'none') setMessage('');
      else if (value === 'connected') setMessage(canShare(state) ? fr.sharing.allowed : fr.sharing.notAllowed);
      else setMessage(value === 'cancelled' ? fr.backup.cancelled : fr.backup.signInFailed);
    });
  }, []);
  return message;
}

/** What the sharing needs first: a Google Drive connection, then the permission to create files. */
export function SharingNeeds({ state, returnTo }: { state: BackupState | undefined; returnTo: string }) {
  if (!state?.refreshToken) {
    return (
      <div class="backup__actions">
        <p class="screen__intro">{fr.sharing.needDrive}</p>
        <a class="button button--primary button--large" href={routeHref('backup')}>
          {fr.sharing.needDriveAction}
        </a>
      </div>
    );
  }
  return (
    <div class="backup__actions">
      <p class="screen__intro">{fr.sharing.needScope}</p>
      <button type="button" class="button button--primary button--large" onClick={() => void startSignIn(db, returnTo)}>
        {fr.sharing.allow}
      </button>
    </div>
  );
}

/** « Partage en famille » (lot 13): the user's places and their sharing, and the places shared with the user. */
export function SharingScreen() {
  const data = useLiveQuery<SharingData | undefined>(
    async () => ({
      state: await getBackupState(),
      sites: sortByOrder(await db.sites.toArray()),
      withYou: await loadSharedPlaces(),
    }),
    [],
    undefined,
  );
  const message = useAllowResult();

  if (!data) return <main class="screen" />;
  const { state, sites, withYou } = data;
  const allowed = canShare(state);

  return (
    <Screen title={fr.sharing.title}>
      <BackLink href={routeHref('settings')} label={fr.sharing.back} />
      <p class="screen__intro">{fr.sharing.intro}</p>
      <p class="status-line" role="status">
        {message}
      </p>

      {allowed ? (
        <section class="section" aria-labelledby="own-places-title">
          <h2 class="section__title" id="own-places-title">
            {fr.sharing.yourPlaces}
          </h2>
          <div class="card">
            {sites.map((site) => (
              <a key={site.id} class="link-row link-row--detail" href={routeHref('sharing', site.id)}>
                <span class="setting__text">
                  <span class="setting__label">{site.name}</span>
                  <span class="setting__detail">
                    {site.share ? fr.sharing.sharedSince(formatDate(new Date(site.share.sharedAt))) : fr.sharing.notShared}
                  </span>
                </span>
                <ChevronRightIcon size={18} />
              </a>
            ))}
          </div>
          <p class="field__hint">{fr.sharing.setupHint}</p>
        </section>
      ) : (
        <SharingNeeds state={state} returnTo={ROUTE_HASHES.sharing} />
      )}

      {withYou.length > 0 && (
        <section class="section" aria-labelledby="with-you-title">
          <h2 class="section__title" id="with-you-title">
            {fr.sharing.withYou}
          </h2>
          <div class="card">
            {withYou.map((place) => (
              <a key={place.fileId} class="link-row link-row--detail" href={routeHref('sharedPlace', place.fileId)}>
                <span class="setting__text">
                  <span class="setting__label">{place.name}</span>
                  <span class="setting__detail">
                    {place.endedAt === undefined ? fr.sharing.sharedBy(place.owner || fr.sharing.someone) : fr.sharing.ended}
                  </span>
                </span>
                <ChevronRightIcon size={18} />
              </a>
            ))}
          </div>
        </section>
      )}
    </Screen>
  );
}
