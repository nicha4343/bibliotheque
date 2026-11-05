import { useEffect, useState } from 'preact/hooks';
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { Id, Site, Timestamp } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, rememberShownSite, shownSiteOf, takeCreatedShelf, type PlaceIndex } from '../places/places';
import { NewSiteSheet, SiteChips } from '../places/SiteChips';
import { routeHref } from '../router';
import { formatDate, fr } from '../textes/fr';

interface ShelvesData {
  places: PlaceIndex;
  /** Copies on each shelf, those declared lost aside. */
  counts: Map<Id, number>;
  /** End of the last check of each shelf. */
  checkedAt: Map<Id, Timestamp>;
}

async function loadShelves(): Promise<ShelvesData> {
  const [places, copies, checks] = await Promise.all([loadPlaces(), db.copies.toArray(), db.shelfChecks.toArray()]);
  const counts = new Map<Id, number>();
  for (const copy of copies) if (copy.lostAt === undefined) counts.set(copy.shelfId, (counts.get(copy.shelfId) ?? 0) + 1);
  const checkedAt = new Map<Id, Timestamp>();
  for (const check of checks) {
    if (check.endedAt !== undefined && check.endedAt > (checkedAt.get(check.shelfId) ?? 0)) checkedAt.set(check.shelfId, check.endedAt);
  }
  return { places, counts, checkedAt };
}

const rowId = (shelfId: Id) => `shelf-row-${shelfId}`;

/**
 * « Étagères », from the library: every shelf by room, leading to its view (screen 8), and « Pièces et
 * étagères » to create, rename or delete them; the shelf created there is pointed out on return. With
 * several places, one place at a time, chosen by its chip.
 */
export function ShelvesScreen() {
  const data = useLiveQuery<ShelvesData | undefined>(() => loadShelves(), [], undefined);
  const places = data?.places;
  const [created] = useState(takeCreatedShelf);
  const [siteId, setSiteId] = useState<Id>();
  const [addingSite, setAddingSite] = useState(false);
  const shown = Boolean(data);
  const site =
    places &&
    (places.sites.find((s) => s.id === siteId) ?? (created ? places.byShelfId.get(created)?.site : undefined) ?? shownSiteOf(places));
  const rooms = (site && places.roomsBySite.get(site.id)) ?? [];

  useEffect(() => {
    if (shown && created) document.getElementById(rowId(created))?.scrollIntoView({ block: 'center' });
  }, [shown, created]);

  const show = (chosen: Site) => {
    rememberShownSite(chosen.id);
    setSiteId(chosen.id);
  };

  const subtitle =
    places &&
    (places.severalSites
      ? fr.shelves.summarySites(places.byShelfId.size, places.sites.length)
      : fr.shelves.summary(places.byShelfId.size));

  return (
    <Screen title={fr.shelves.title} subtitle={subtitle}>
      <div class="back-bar">
        <a class="text-button back-bar__link" href={routeHref('library')}>
          <ChevronLeftIcon size={20} />
          {fr.shelves.back}
        </a>
        <a class="text-button text-button--soft" href={routeHref('places')}>
          <PencilIcon size={16} />
          {fr.shelves.manage}
        </a>
      </div>

      {places && site && (
        <SiteChips
          places={places}
          shown={site}
          onShow={show}
          onAdd={() => {
            setAddingSite(true);
          }}
        />
      )}

      {places && rooms.length === 0 && (
        <p class="screen__intro">
          {places.severalSites ? fr.sites.noShelves : fr.shelves.empty} <a href={routeHref('places')}>{fr.places.screenTitle}</a>
        </p>
      )}

      {data &&
        rooms.map((room) => (
          <section key={room.id} class="section" aria-labelledby={`room-${room.id}`}>
            <h2 class="section__title" id={`room-${room.id}`}>
              {room.name}
            </h2>
            <div class="card">
              {(data.places.shelvesByRoom.get(room.id) ?? []).map((shelf) => {
                const checked = data.checkedAt.get(shelf.id);
                const books = fr.shelves.books(data.counts.get(shelf.id) ?? 0);
                return (
                  <a
                    key={shelf.id}
                    id={rowId(shelf.id)}
                    class={shelf.id === created ? 'link-row link-row--detail link-row--new' : 'link-row link-row--detail'}
                    href={routeHref('shelf', shelf.id)}
                  >
                    <span class="setting__text">
                      <span class="setting__label">{shelf.name}</span>
                      <span class="setting__detail">
                        {checked === undefined ? books : `${books} · ${fr.shelves.checkedOn(formatDate(new Date(checked)))}`}
                      </span>
                    </span>
                    <ChevronRightIcon size={18} />
                  </a>
                );
              })}
            </div>
          </section>
        ))}

      {places && addingSite && (
        <NewSiteSheet
          places={places}
          onCreated={(newSite) => {
            setAddingSite(false);
            show(newSite);
          }}
          onClose={() => {
            setAddingSite(false);
          }}
        />
      )}
    </Screen>
  );
}
