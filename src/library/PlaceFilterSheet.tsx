import { Sheet } from '../components/Sheet';
import type { PlaceIndex } from '../places/places';
import { formatNumber, fr } from '../textes/fr';
import { ALL_PLACES, placeSelection, type PlaceValue } from './placeFilter';

interface PlaceFilterSheetProps {
  places: PlaceIndex;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  /** Books shown for this place, with the search and the reading status chosen. */
  countOf: (value: PlaceValue) => number;
  onClose: () => void;
}

/**
 * « Emplacement », from the library (lot 11, instead of a drop-down list): the place, then its room,
 * then its shelf, each with its number of books; the list behind follows at once. Choosing a shelf, the
 * narrowest level, closes the sheet.
 */
export function PlaceFilterSheet({ places, value, onChange, countOf, onClose }: PlaceFilterSheetProps) {
  const { siteId, roomId, shelfId } = placeSelection(value, places);
  const rooms = (siteId && places.roomsBySite.get(siteId)) || [];
  const room = rooms.find((r) => r.id === roomId);
  const shelves = (room && places.shelvesByRoom.get(room.id)) || [];

  const chip = (chipValue: PlaceValue, label: string, pressed: boolean) => (
    <button
      key={chipValue}
      type="button"
      class="chip chip--large"
      aria-pressed={pressed}
      onClick={() => {
        onChange(chipValue);
      }}
    >
      {label}{' '}
      <span class="chip__count">{formatNumber(countOf(chipValue))}</span>
    </button>
  );

  const option = (optionValue: PlaceValue, label: string, pressed: boolean, close: boolean) => (
    <button
      key={optionValue}
      type="button"
      class="option-list__item"
      aria-pressed={pressed}
      onClick={() => {
        onChange(optionValue);
        if (close) onClose();
      }}
    >
      <span class="radio" aria-hidden="true" />
      <span class="option-list__label">{label}</span>
      <span class="option-list__count">{formatNumber(countOf(optionValue))}</span>
    </button>
  );

  return (
    <Sheet title={fr.library.placeTitle} onClose={onClose}>
      {places.severalSites && (
        <>
          <h3 class="sheet__label">{fr.sites.label}</h3>
          <div class="chips chips--wrap">
            {chip(ALL_PLACES, fr.sites.allSites, value === ALL_PLACES)}
            {places.sites.map((site) => chip(`site:${site.id}`, site.name, site.id === siteId))}
          </div>
        </>
      )}

      {siteId && rooms.length > 0 && (
        <>
          <h3 class="sheet__label">{fr.places.room}</h3>
          <div class="chips chips--wrap">
            {chip(places.severalSites ? `site:${siteId}` : ALL_PLACES, fr.library.allPlaces, roomId === undefined)}
            {rooms.map((r) => chip(`room:${r.id}`, r.name, r.id === roomId))}
          </div>
        </>
      )}

      {room && (
        <>
          <h3 class="sheet__label">{fr.places.shelvesOf(room.name)}</h3>
          <div class="option-list">
            {option(`room:${room.id}`, fr.library.allShelves, shelfId === undefined, false)}
            {shelves.map((shelf) => option(`shelf:${shelf.id}`, shelf.name, shelf.id === shelfId, true))}
          </div>
        </>
      )}

      <div class="sheet__actions">
        <button type="button" class="button button--primary button--large" onClick={onClose}>
          {fr.library.placeShow(countOf(value))}
        </button>
      </div>
    </Sheet>
  );
}
