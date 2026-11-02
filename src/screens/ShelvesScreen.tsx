import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { Id, Timestamp } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, type PlaceIndex } from '../places/places';
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

/** « Étagères », from the library: every shelf by room, leading to its view (screen 8). */
export function ShelvesScreen() {
  const data = useLiveQuery<ShelvesData | undefined>(() => loadShelves(), [], undefined);
  const places = data?.places;

  return (
    <Screen title={fr.shelves.title} subtitle={places && fr.shelves.summary(places.byShelfId.size)}>
      <div class="back-bar">
        <a class="text-button back-bar__link" href={routeHref('library')}>
          <ChevronLeftIcon size={20} />
          {fr.shelves.back}
        </a>
      </div>

      {places?.rooms.length === 0 && (
        <p class="screen__intro">
          {fr.shelves.empty} <a href={routeHref('places')}>{fr.places.screenTitle}</a>
        </p>
      )}

      {data &&
        places?.rooms.map((room) => (
          <section key={room.id} class="section" aria-labelledby={`room-${room.id}`}>
            <h2 class="section__title" id={`room-${room.id}`}>
              {room.name}
            </h2>
            <div class="card">
              {(places.shelvesByRoom.get(room.id) ?? []).map((shelf) => {
                const checked = data.checkedAt.get(shelf.id);
                const books = fr.shelves.books(data.counts.get(shelf.id) ?? 0);
                return (
                  <a key={shelf.id} class="link-row link-row--detail" href={routeHref('shelf', shelf.id)}>
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
    </Screen>
  );
}
