import type { Place } from '../places/places';

/**
 * The place of a scan, in its pill: « Salon · Étagère 2 », with the place in small above it when the
 * library has several (« Maison de campagne »).
 */
export function PlaceLabel({ place, severalSites, fallback }: { place: Place | undefined; severalSites: boolean; fallback: string }) {
  return (
    <span class="scan__place-text">
      {place && severalSites && <span class="scan__place-site">{place.site.name}</span>}
      <span class="scan__place-label">{place?.roomLabel ?? fallback}</span>
    </span>
  );
}
