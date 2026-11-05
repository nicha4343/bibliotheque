import { useState } from 'preact/hooks';
import { PlusIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import type { Id, Shelf, Site } from '../db/schema';
import { formatNumber, fr } from '../textes/fr';
import { createSite, type PlaceIndex } from './places';

/** The shelves of a place, room by room. */
export const shelvesOfSite = (places: PlaceIndex, siteId: Id): Shelf[] =>
  (places.roomsBySite.get(siteId) ?? []).flatMap((room) => places.shelvesByRoom.get(room.id) ?? []);

interface SiteChipsProps {
  places: PlaceIndex;
  shown: Site;
  onShow: (site: Site) => void;
  onAdd: () => void;
}

/**
 * « Étagères » and « Pièces et étagères »: one chip per place, with its number of shelves, then
 * « Nouveau lieu ». Nothing while the library has a single place: the screens stay as they were.
 */
export function SiteChips({ places, shown, onShow, onAdd }: SiteChipsProps) {
  if (!places.severalSites) return null;
  return (
    <div class="chips chips--wrap" role="group" aria-label={fr.sites.label}>
      {places.sites.map((site) => {
        const shelves = shelvesOfSite(places, site.id).length;
        return (
          <button
            key={site.id}
            type="button"
            class="chip chip--large"
            aria-pressed={site.id === shown.id}
            onClick={() => {
              onShow(site);
            }}
          >
            {site.name}
            <span class="chip__count">
              {formatNumber(shelves)}
              <span class="visually-hidden"> {fr.sites.shelvesWord(shelves)}</span>
            </span>
          </button>
        );
      })}
      <button type="button" class="chip chip--large chip--add" onClick={onAdd}>
        <PlusIcon size={16} />
        {fr.sites.newSite}
      </button>
    </div>
  );
}

interface NewSiteSheetProps {
  places: PlaceIndex;
  /** The place created, or the one that already bore this name. */
  onCreated: (site: Site) => void;
  onClose: () => void;
}

/** « Nouveau lieu »: a name, nothing else; its rooms are created afterwards. */
export function NewSiteSheet({ places, onCreated, onClose }: NewSiteSheetProps) {
  const [name, setName] = useState('');
  const first = places.sites[0];

  const submit = async (event: Event) => {
    event.preventDefault();
    const wanted = name.trim();
    if (!wanted) return;
    const existing = places.sites.find((site) => site.name.toLocaleLowerCase('fr') === wanted.toLocaleLowerCase('fr'));
    onCreated(existing ?? (await createSite(wanted)));
  };

  return (
    <Sheet title={fr.sites.newSite} onClose={onClose}>
      <form class="sheet__form" onSubmit={(event) => void submit(event)}>
        <div class="field">
          <label class="field__label" for="new-site">
            {fr.sites.newSiteLabel}
          </label>
          <input
            id="new-site"
            class="field__input"
            type="text"
            value={name}
            placeholder={fr.sites.newSitePlaceholder}
            autocomplete="off"
            enterKeyHint="done"
            onInput={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        </div>
        <p class="sheet__hint">
          {fr.sites.newSiteHint}
          {!places.severalSites && first && ` ${fr.sites.firstSiteHint(first.name)}`}
        </p>
        <button type="submit" class="button button--primary button--large" disabled={!name.trim()}>
          {fr.common.create}
        </button>
      </form>
    </Sheet>
  );
}
