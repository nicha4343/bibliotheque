import { useState } from 'preact/hooks';
import { BackAnchor } from '../components/BackLink';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PencilIcon, PlusIcon, QrIcon, TrashIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Id, Room, Shelf } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import {
  createRoom,
  createShelf,
  deleteRoomIfEmpty,
  deleteShelfIfEmpty,
  loadPlaces,
  noteCreatedShelf,
  renameRoom,
  renameShelf,
  type PlaceIndex,
} from '../places/places';
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

type Target = { kind: 'room'; room: Room } | { kind: 'shelf'; shelf: Shelf };
type Dialog = { action: 'rename' | 'delete'; target: Target };

const nameOf = (target: Target) => (target.kind === 'room' ? target.room.name : target.shelf.name);

/** Rooms and shelves: create, rename, delete when empty. */
export function PlacesScreen() {
  const data = useLiveQuery<PlacesData | undefined>(() => loadData(), [], undefined);
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState('');

  const close = () => {
    setDialog(undefined);
  };

  const remove = async (target: Target) => {
    close();
    const done = target.kind === 'room' ? await deleteRoomIfEmpty(target.room.id) : await deleteShelfIfEmpty(target.shelf.id);
    setMessage(done ? '' : fr.places.notEmpty);
  };

  // « Étagères » points out the shelf created here when the user comes back to it.
  const addShelf = async (roomId: Id) => {
    const shelf = await createShelf(roomId);
    noteCreatedShelf(shelf.id);
  };

  const addRoom = async (event: Event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const { shelf } = await createRoom(draft);
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
      <p class="status-line status-line--warn" role="status">
        {message}
      </p>

      {data?.places.rooms.length === 0 && <p class="screen__intro">{fr.places.noRooms}</p>}

      {data?.places.rooms.map((room) => {
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
            {fr.places.newRoomLabel}
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

      {dialog?.action === 'rename' && <RenameSheet target={dialog.target} onClose={close} />}
      {dialog?.action === 'delete' && (
        <ConfirmSheet
          title={dialog.target.kind === 'room' ? fr.places.deleteRoomTitle : fr.places.deleteShelfTitle}
          text={
            dialog.target.kind === 'room'
              ? fr.places.deleteRoomText(nameOf(dialog.target))
              : fr.places.deleteShelfText(nameOf(dialog.target))
          }
          confirm={fr.places.deleteConfirm}
          onConfirm={() => void remove(dialog.target)}
          onClose={close}
        />
      )}
    </Screen>
  );
}

function RenameSheet({ target, onClose }: { target: Target; onClose: () => void }) {
  const [name, setName] = useState(nameOf(target));

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (target.kind === 'room') await renameRoom(target.room.id, name);
    else await renameShelf(target.shelf.id, name);
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
        <p class="sheet__hint">{fr.places.namesHint}</p>
        <button type="submit" class="button button--primary button--large" disabled={!name.trim()}>
          {fr.common.save}
        </button>
      </form>
    </Sheet>
  );
}
