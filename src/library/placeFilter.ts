import type { Id } from '../db/schema';
import type { PlaceIndex } from '../places/places';
import { fr } from '../textes/fr';
import type { PlaceFilter } from './filter';

// The place filter of the library, kept as a short value: 'all', 'site:<id>', 'room:<id>' or 'shelf:<id>'.

export type PlaceValue = string;

export const ALL_PLACES: PlaceValue = 'all';

const parse = (value: PlaceValue): [string, Id] => {
  const [kind = 'all', id = ''] = value.split(':');
  return [kind, id];
};

/** The value still names a place of the library (it may have been deleted meanwhile). */
export function hasPlace(value: PlaceValue, places: PlaceIndex): boolean {
  const [kind, id] = parse(value);
  if (kind === 'site') return places.severalSites && places.roomsBySite.has(id);
  if (kind === 'room') return places.shelvesByRoom.has(id);
  if (kind === 'shelf') return places.byShelfId.has(id);
  return kind === 'all';
}

export function placeFilter(value: PlaceValue, places: PlaceIndex): PlaceFilter {
  const [kind, id] = parse(value);
  if (kind === 'shelf') return { kind: 'shelf', shelfId: id };
  if (kind === 'room') return { kind: 'room', shelfIds: new Set((places.shelvesByRoom.get(id) ?? []).map((shelf) => shelf.id)) };
  if (kind === 'site') {
    const shelves = (places.roomsBySite.get(id) ?? []).flatMap((room) => places.shelvesByRoom.get(room.id) ?? []);
    return { kind: 'room', shelfIds: new Set(shelves.map((shelf) => shelf.id)) };
  }
  return { kind: 'all' };
}

export interface PlaceSelection {
  siteId?: Id;
  roomId?: Id;
  shelfId?: Id;
}

/** The place, room and shelf the value designates, the wider levels included. */
export function placeSelection(value: PlaceValue, places: PlaceIndex): PlaceSelection {
  const [kind, id] = parse(value);
  if (kind === 'shelf') {
    const place = places.byShelfId.get(id);
    return place ? { siteId: place.site.id, roomId: place.room.id, shelfId: id } : {};
  }
  if (kind === 'room') {
    const site = places.siteOfRoom.get(id);
    return site ? { siteId: site.id, roomId: id } : {};
  }
  if (kind === 'site') return { siteId: id };
  // With a single place, its rooms are listed at once.
  const only = places.severalSites ? undefined : places.sites[0];
  return only ? { siteId: only.id } : {};
}

/** Text of the filter button: « Salon · Étagère 2 », with its place (« Maison ») in small above when there are several. */
export function placeFilterParts(value: PlaceValue, places: PlaceIndex): { site?: string; main: string } {
  const [kind, id] = parse(value);
  if (kind === 'shelf') {
    const place = places.byShelfId.get(id);
    if (place) return places.severalSites ? { site: place.site.name, main: place.roomLabel } : { main: place.roomLabel };
  }
  if (kind === 'room') {
    const room = places.rooms.find((r) => r.id === id);
    const site = places.siteOfRoom.get(id);
    if (room) return places.severalSites && site ? { site: site.name, main: room.name } : { main: room.name };
  }
  if (kind === 'site') {
    const site = places.sites.find((s) => s.id === id);
    if (site) return { main: site.name };
  }
  return { main: places.severalSites ? fr.sites.allSites : fr.library.allPlaces };
}

/** The same in one line: « Tous les lieux », « Maison », « Maison · Salon », « Maison · Salon · Étagère 2 ». */
export function placeFilterLabel(value: PlaceValue, places: PlaceIndex): string {
  const { site, main } = placeFilterParts(value, places);
  return site ? fr.places.label(site, main) : main;
}
