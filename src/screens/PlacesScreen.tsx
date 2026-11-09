import { useState } from 'preact/hooks';
import { BackAnchor } from '../components/BackLink';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PencilIcon, PlusIcon, QrIcon, ShareIcon, TrashIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Id, Room, Shelf, Site } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import {
  createRoom,
  createShelf,
  deleteRoomIfEmpty,
  deleteShelfIfEmpty,
  deleteSiteIfEmpty,
  loadPlaces,
  moveRoom,
  noteCreatedShelf,
  rememberShownSite,
  renameRoom,
  renameShelf,
  renameSite,
  shownSiteOf,
  type PlaceIndex,
} from '../places/places';
import { NewSiteSheet, shelvesOfSite, SiteChips } from '../places/SiteChips';
import { routeHref } from '../router';
import { fr } from '../textes/fr';

interface PlacesData {
  places: PlaceIndex;
  /** Copies and items to complete per shelf: a shelf in use cannot be deleted. */
  usage: Map<Id, number>;
}

async function loadData(): Promise<PlacesData> {
  const [places, copies, pending] = await Promise.all([loadPlaces(), db.copies.toArray(), db.pendingItems.toArray()]);
  const usage = new Map<Id, number>();
  for (const { shelfId } of [...copies, ...pending]) usage.set(shelfId, (usage.get(shelfId) ?? 0) + 1);
  return { places, usage };
}

type Target = { kind: 'site'; site: Site } | { kind: 'room'; room: Room } | { kind: 'shelf'; shelf: Shelf };
type Dialog = { action: 'rename' | 'delete'; target: Target } | { action: 'newSite' };

const nameOf = (target: Target) =>
  target.kind === 'site' ? target.site.name : target.kind === 'room' ? target.room.name : target.shelf.name;

const DELETE_TEXTS = {
  site: { title: fr.sites.deleteTitle, text: fr.sites.deleteText },
  room: { title: fr.places.deleteRoomTitle, text: fr.places.deleteRoomText },
  shelf: { title: fr.places.deleteShelfTitle, text: fr.places.deleteShelfText },
};

/** Places, rooms and shelves: create, rename, delete when empty; with several places, one at a time. */
export function PlacesScreen() {
  const data = useLiveQuery<PlacesData | undefined>(() => loadData(), [], undefined);
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState('');
  const [siteId, setSiteId] = useState<Id>();
  const places = data?.places;
  const site = places && (places.sites.find((s) => s.id === siteId) ?? shownSiteOf(places));
  const rooms = (site && places.roomsBySite.get(site.id)) ?? [];
  const siteUsed = Boolean(site && shelvesOfSite(data.places, site.id).some((shelf) => (data.usage.get(shelf.id) ?? 0) > 0));

  const close = () => {
    setDialog(undefined);
  };

  const show = (chosen: Site) => {
    rememberShownSite(chosen.id);
    setSiteId(chosen.id);
    setMessage('');
  };

  const remove = async (target: Target) => {
    close();
    const done =
      target.kind === 'site'
        ? await deleteSiteIfEmpty(target.site.id)
        : target.kind === 'room'
          ? await deleteRoomIfEmpty(target.room.id)
          : await deleteShelfIfEmpty(target.shelf.id);
    setMessage(done ? '' : target.kind === 'site' ? fr.sites.notEmpty : fr.places.notEmpty);
  };

  // « Étagères » points out the shelf created here when the user comes back to it.
  const addShelf = async (roomId: Id) => {
    const shelf = await createShelf(roomId);
    noteCreatedShelf(shelf.id);
  };

  const addRoom = async (event: Event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const { shelf } = await createRoom(draft, db, site?.id);
    noteCreatedShelf(shelf.id);
    setDraft('');
  };

  return (
    <Screen title={fr.places.screenTitle}>
      <div class="back-bar">
        <BackAnchor href={routeHref('settings')} label={fr.places.back} />
        <a class="text-button" href={routeHref('labels')}>
          <QrIcon size={18} />
          {fr.settings.labels}
        </a>
      </div>
      <p class="screen__intro">{fr.places.intro}</p>

      {places && site && (
        <SiteChips
          places={places}
          shown={site}
          onShow={show}
          onAdd={() => {
            setDialog({ action: 'newSite' });
          }}
        />
      )}
      {places?.severalSites && site && (
        <div class="place-site">
          <button
            type="button"
            class="text-button"
            onClick={() => {
              setDialog({ action: 'rename', target: { kind: 'site', site } });
            }}
          >
            <PencilIcon size={16} />
            {fr.sites.rename(site.name)}
          </button>
          {!siteUsed && !site.share && (
            <button
              type="button"
              class="icon-button place__delete"
              aria-label={fr.sites.delete(site.name)}
              onClick={() => {
                setDialog({ action: 'delete', target: { kind: 'site', site } });
              }}
            >
              <TrashIcon size={18} />
            </button>
          )}
        </div>
      )}
      {places?.severalSites && site && (
        <div class="place-site">
          <a class="text-button" href={routeHref('sharing', site.id)}>
            <ShareIcon size={16} />
            {site.share ? fr.sharing.title : fr.sharing.placesLink(site.name)}
          </a>
        </div>
      )}

      <p class="status-line status-line--warn" role="status">
        {message}
      </p>

      {places && rooms.length === 0 && <p class="screen__intro">{places.severalSites ? fr.sites.noRooms : fr.places.noRooms}</p>}

      {data &&
        rooms.map((room) => {
          const shelves = data.places.shelvesByRoom.get(room.id) ?? [];
          return (
            <section key={room.id} class="section" aria-label={room.name}>
              <div class="place-room">
                <button
                  type="button"
                  class="place-room__name"
                  aria-label={fr.places.rename(room.name)}
                  onClick={() => {
                    setDialog({ action: 'rename', target: { kind: 'room', room } });
                  }}
                >
                  {room.name}
                  <PencilIcon size={16} />
                </button>
                <button
                  type="button"
                  class="icon-button place__delete"
                  aria-label={fr.places.deleteRoom(room.name)}
                  onClick={() => {
                    setDialog({ action: 'delete', target: { kind: 'room', room } });
                  }}
                >
                  <TrashIcon size={18} />
                </button>
              </div>
              <ul class="card place-list">
                {shelves.map((shelf) => {
                  const used = data.usage.get(shelf.id) ?? 0;
                  return (
                    <li key={shelf.id} class="place-shelf">
                      <button
                        type="button"
                        class="place-shelf__name"
                        aria-label={fr.places.rename(shelf.name)}
                        onClick={() => {
                          setDialog({ action: 'rename', target: { kind: 'shelf', shelf } });
                        }}
                      >
                        <span>{shelf.name}</span>
                        <span class="place-shelf__count">{fr.places.copies(used)}</span>
                      </button>
                      {used === 0 && (
                        <button
                          type="button"
                          class="icon-button place__delete"
                          aria-label={fr.places.deleteShelf(shelf.name)}
                          onClick={() => {
                            setDialog({ action: 'delete', target: { kind: 'shelf', shelf } });
                          }}
                        >
                          <TrashIcon size={18} />
                        </button>
                      )}
                    </li>
                  );
                })}
                <li class="place-shelf">
                  <button type="button" class="place-shelf__add" onClick={() => void addShelf(room.id)}>
                    <PlusIcon size={18} />
                    {fr.places.newShelf}
                  </button>
                </li>
              </ul>
            </section>
          );
        })}

      <form class="inline-form" onSubmit={(event) => void addRoom(event)}>
        <div class="field inline-form__field">
          <label class="field__label" for="places-new-room">
            {places?.severalSites && site ? fr.sites.newRoomIn(site.name) : fr.places.newRoomLabel}
          </label>
          <input
            id="places-new-room"
            class="field__input"
            type="text"
            value={draft}
            placeholder={fr.places.newRoomPlaceholder}
            autocomplete="off"
            enterKeyHint="done"
            onInput={(event) => {
              setDraft(event.currentTarget.value);
            }}
          />
        </div>
        <button type="submit" class="button button--primary" disabled={!draft.trim()}>
          {fr.common.create}
        </button>
      </form>

      {places && !places.severalSites && (
        <section class="section place-sites" aria-label={fr.sites.newSite}>
          <p class="screen__intro">{fr.sites.oneSiteIntro}</p>
          <button
            type="button"
            class="text-button text-button--soft place-sites__add"
            onClick={() => {
              setDialog({ action: 'newSite' });
            }}
          >
            <PlusIcon size={18} />
            {fr.sites.newSite}
          </button>
        </section>
      )}

      {dialog?.action === 'newSite' && places && (
        <NewSiteSheet
          places={places}
          onCreated={(created) => {
            close();
            show(created);
          }}
          onClose={close}
        />
      )}
      {dialog?.action === 'rename' && places && <RenameSheet target={dialog.target} places={places} onClose={close} />}
      {dialog?.action === 'delete' && (
        <ConfirmSheet
          title={DELETE_TEXTS[dialog.target.kind].title}
          text={DELETE_TEXTS[dialog.target.kind].text(nameOf(dialog.target))}
          confirm={fr.places.deleteConfirm}
          onConfirm={() => void remove(dialog.target)}
          onClose={close}
        />
      )}
    </Screen>
  );
}

/** A new name; for a room, with several places, also the place it belongs to. */
function RenameSheet({ target, places, onClose }: { target: Target; places: PlaceIndex; onClose: () => void }) {
  const [name, setName] = useState(nameOf(target));
  const [siteId, setSiteId] = useState(target.kind === 'room' ? target.room.siteId : undefined);
  const movable = target.kind === 'room' && places.severalSites;

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (target.kind === 'site') await renameSite(target.site.id, name);
    else if (target.kind === 'room') {
      await renameRoom(target.room.id, name);
      if (siteId && siteId !== target.room.siteId) await moveRoom(target.room.id, siteId);
    } else await renameShelf(target.shelf.id, name);
    onClose();
  };

  return (
    <Sheet title={fr.places.renameTitle} onClose={onClose}>
      <form class="sheet__form" onSubmit={(event) => void submit(event)}>
        <div class="field">
          <label class="field__label" for="rename-field">
            {fr.places.nameLabel}
          </label>
          <input
            id="rename-field"
            class="field__input"
            type="text"
            value={name}
            autocomplete="off"
            enterKeyHint="done"
            onInput={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        </div>
        {movable && (
          <div class="field">
            <h3 class="sheet__label" id="rename-site">
              {fr.sites.roomSite}
            </h3>
            <div class="chips chips--wrap" role="group" aria-labelledby="rename-site">
              {places.sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  class="chip chip--large"
                  aria-pressed={site.id === siteId}
                  onClick={() => {
                    setSiteId(site.id);
                  }}
                >
                  {site.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <p class="sheet__hint">{target.kind === 'site' ? fr.sites.newSiteHint : fr.places.namesHint}</p>
        <button type="submit" class="button button--primary button--large" disabled={!name.trim()}>
          {fr.common.save}
        </button>
      </form>
    </Sheet>
  );
}
