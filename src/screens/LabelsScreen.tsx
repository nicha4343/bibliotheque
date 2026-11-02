import { useEffect, useState } from 'preact/hooks';
import { ChevronLeftIcon } from '../components/icons';
import { QrCode } from '../components/QrCode';
import { Screen } from '../components/Screen';
import type { Id } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { routeHref } from '../router';
import { shelfQrContent } from '../scan/reads';
import { fr } from '../textes/fr';

/**
 * Shelf QR labels, printed from the browser: scanning one makes its shelf the current place. From a
 * shelf view (shelfId), only that shelf's label is chosen at first.
 */
export function LabelsScreen({ shelfId }: { shelfId?: string | undefined }) {
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  // Shelves left out by the user; every shelf is printed by default.
  const [excluded, setExcluded] = useState<ReadonlySet<Id>>(new Set());

  const shelves = places ? [...places.byShelfId.values()] : [];
  const chosen = shelves.filter(({ shelf }) => !excluded.has(shelf.id));
  const from = shelfId ? places?.byShelfId.get(shelfId) : undefined;

  const loaded = Boolean(places);
  useEffect(() => {
    if (loaded && shelfId) setExcluded(new Set(shelves.map(({ shelf }) => shelf.id).filter((id) => id !== shelfId)));
  }, [loaded, shelfId]);

  const toggle = (id: Id, on: boolean) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Screen title={fr.labels.title}>
      <div class="back-bar no-print">
        <a class="text-button back-bar__link" href={from ? routeHref('shelf', from.shelf.id) : routeHref('settings')}>
          <ChevronLeftIcon size={20} />
          {from ? from.label : fr.labels.back}
        </a>
      </div>

      {places && shelves.length === 0 && (
        <p class="screen__intro">
          {fr.labels.noShelves}{' '}
          <a href={routeHref('places')}>{fr.places.screenTitle}</a>
        </p>
      )}

      {shelves.length > 0 && (
        <>
          <p class="screen__intro no-print">{fr.labels.intro}</p>
          <fieldset class="label-choice no-print">
            <legend class="section__title">{fr.labels.choose}</legend>
            <div class="chips">
              <button
                type="button"
                class="chip"
                onClick={() => {
                  setExcluded(new Set());
                }}
              >
                {fr.labels.all}
              </button>
              <button
                type="button"
                class="chip"
                onClick={() => {
                  setExcluded(new Set(shelves.map(({ shelf }) => shelf.id)));
                }}
              >
                {fr.labels.none}
              </button>
            </div>
            <div class="card">
              {shelves.map(({ shelf, label }) => (
                <label key={shelf.id} class="check-row">
                  <input
                    type="checkbox"
                    class="check-row__box"
                    checked={!excluded.has(shelf.id)}
                    onChange={(event) => {
                      toggle(shelf.id, event.currentTarget.checked);
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            class="button button--primary button--large no-print"
            disabled={chosen.length === 0}
            onClick={() => {
              window.print();
            }}
          >
            {fr.labels.print(chosen.length)}
          </button>
          <p class="sheet__hint no-print">{fr.labels.hint}</p>

          <ul class="labels">
            {chosen.map(({ room, shelf }) => (
              <li key={shelf.id} class="label">
                <QrCode class="label__qr" value={shelfQrContent(window.location.href, shelf.qrToken)} />
                <span class="label__text">
                  <span class="label__room">{room.name}</span>
                  <span class="label__shelf">{shelf.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}
