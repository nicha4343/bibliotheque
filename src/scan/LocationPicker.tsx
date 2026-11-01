import { useState } from 'preact/hooks';
import { PlusIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import type { Id, Shelf } from '../db/schema';
import { createRoom, createShelf, type PlaceIndex } from '../places/places';
import { fr } from '../textes/fr';

interface LocationPickerProps {
  places: PlaceIndex;
  currentShelfId: Id | undefined;
  onPick: (shelf: Shelf) => void;
  /** « Où ranger ces ouvrages ? » by default. */
  title?: string;
  /** Absent while no shelf has been chosen yet: a place is needed to scan. */
  onClose?: (() => void) | undefined;
}

/** « Où ranger ces ouvrages ? » — choosing a shelf closes the picker. */
export function LocationPicker({ places, currentShelfId, onPick, title = fr.places.pickerTitle, onClose }: LocationPickerProps) {
  const currentRoomId = currentShelfId ? places.byShelfId.get(currentShelfId)?.room.id : undefined;
  const [roomId, setRoomId] = useState<Id | undefined>(currentRoomId ?? places.rooms[0]?.id);
  const [addingRoom, setAddingRoom] = useState(places.rooms.length === 0);
  const [draft, setDraft] = useState('');
  const room = places.rooms.find((r) => r.id === roomId);
  const shelves = room ? (places.shelvesByRoom.get(room.id) ?? []) : [];

  const submitRoom = async (event: Event) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    const existing = places.rooms.find((r) => r.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
    if (existing) {
      setRoomId(existing.id);
    } else {
      const created = await createRoom(name);
      setRoomId(created.room.id);
    }
    setDraft('');
    setAddingRoom(false);
  };

  const addShelf = async () => {
    if (room) await createShelf(room.id);
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <h3 class="sheet__label">{fr.places.room}</h3>
      <div class="chips chips--wrap">
        {places.rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            class="chip chip--large"
            aria-pressed={r.id === roomId}
            onClick={() => {
              setRoomId(r.id);
              setAddingRoom(false);
            }}
          >
            {r.name}
          </button>
        ))}
        <button
          type="button"
          class="chip chip--large chip--add"
          aria-expanded={addingRoom}
          onClick={() => {
            setAddingRoom(true);
          }}
        >
          <PlusIcon size={16} />
          {fr.places.newRoom}
        </button>
      </div>

      {addingRoom && (
        <form class="inline-form" onSubmit={(event) => void submitRoom(event)}>
          <div class="field inline-form__field">
            <label class="field__label" for="new-room">
              {fr.places.newRoomLabel}
            </label>
            <input
              id="new-room"
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
      )}

      {room ? (
        <>
          <h3 class="sheet__label">{fr.places.shelvesOf(room.name)}</h3>
          <div class="option-list">
            {shelves.map((shelf) => (
              <button
                key={shelf.id}
                type="button"
                class="option-list__item"
                aria-pressed={shelf.id === currentShelfId}
                onClick={() => {
                  onPick(shelf);
                }}
              >
                <span class="radio" aria-hidden="true" />
                <span class="option-list__label">{shelf.name}</span>
              </button>
            ))}
            <button type="button" class="option-list__item option-list__item--add" onClick={() => void addShelf()}>
              <PlusIcon size={20} />
              {fr.places.newShelf}
            </button>
          </div>
          <p class="sheet__hint">{fr.places.namesHint}</p>
        </>
      ) : (
        <p class="sheet__hint">{fr.places.firstRoomHint}</p>
      )}
    </Sheet>
  );
}
