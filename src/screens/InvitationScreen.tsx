import { useEffect, useState } from 'preact/hooks';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import { useLiveQuery } from '../db/useLiveQuery';
import { routeHref } from '../router';
import { openInvitation } from '../sharing/guest';
import { decodeInvitation, type Invitation } from '../sharing/invitation';
import { fr } from '../textes/fr';

interface InvitationData {
  /** The place is one of this device's own, shared by its owner. */
  own: boolean;
  /** The place is already copied on this device. */
  opened: boolean;
}

/** The link sent by the owner of a place (lot 13): the place is opened once with Google's file picker. */
export function InvitationScreen({ payload }: { payload: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>();
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void decodeInvitation(payload).then((value) => {
      if (active) setInvitation(value ?? null);
    });
    const update = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      active = false;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [payload]);

  const fileId = invitation?.fileId;
  const data = useLiveQuery<InvitationData | undefined>(
    async () => {
      if (!fileId) return undefined;
      const [sites, place] = await Promise.all([db.sites.toArray(), db.sharedPlaces.get(fileId)]);
      return {
        own: sites.some((site) => site.share?.fileId === fileId),
        opened: Boolean(place?.contents && place.endedAt === undefined),
      };
    },
    [fileId],
    undefined,
  );

  if (invitation === undefined) return <main class="screen" />;
  if (invitation === null) {
    return (
      <Screen title={fr.sharing.invitationTitle}>
        <p class="screen__intro">{fr.sharing.invalid}</p>
      </Screen>
    );
  }

  const owner = invitation.owner || fr.sharing.someone;
  return (
    <Screen title={fr.sharing.invitationTitle}>
      <p class="screen__intro">{fr.sharing.invitationText(owner, invitation.place)}</p>
      {data?.own ? (
        <p class="screen__intro">{fr.sharing.ownPlace}</p>
      ) : data?.opened ? (
        <a class="button button--primary button--large" href={routeHref('sharedPlace', invitation.fileId)}>
          {fr.sharing.consult(invitation.place)}
        </a>
      ) : (
        <>
          <p class="screen__intro">{fr.sharing.invitationSteps(fr.sharing.fileName(invitation.place))}</p>
          {!online && <p class="field__hint">{fr.sharing.openOffline}</p>}
          <button
            type="button"
            class="button button--primary button--large"
            disabled={!online || busy || !data}
            onClick={() => {
              setBusy(true);
              void openInvitation(invitation).finally(() => {
                setBusy(false);
              });
            }}
          >
            {fr.sharing.open}
          </button>
        </>
      )}
    </Screen>
  );
}
