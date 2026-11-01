import { useEffect, useState } from 'preact/hooks';

// Hash-based routes: they work on any static host and offline, without server-side rewrites.
export type RouteId = 'library' | 'scan' | 'pending' | 'settings' | 'recap' | 'entry' | 'book' | 'places' | 'labels';

/** The four tabs of the navigation bar. */
export type TabId = 'library' | 'scan' | 'pending' | 'settings';

export interface Route {
  id: RouteId;
  /** Identifier following the route: a notice, an item to complete, a session. */
  param?: string;
}

export const ROUTE_HASHES: Readonly<Record<RouteId, string>> = {
  library: '#/bibliotheque',
  scan: '#/scanner',
  pending: '#/a-completer',
  settings: '#/parametres',
  recap: '#/bilan',
  entry: '#/saisie',
  book: '#/livre',
  places: '#/pieces',
  labels: '#/etiquettes',
};

export const routeHref = (id: RouteId, param?: string): string =>
  param ? `${ROUTE_HASHES[id]}/${encodeURIComponent(param)}` : ROUTE_HASHES[id];

const DEFAULT_ROUTE: Route = { id: 'library' };
const ROUTE_IDS = Object.keys(ROUTE_HASHES) as RouteId[];

export function parseHash(hash: string): Route {
  for (const id of ROUTE_IDS) {
    const base = ROUTE_HASHES[id];
    if (hash === base) return { id };
    if (hash.startsWith(`${base}/`)) {
      const param = decodeURIComponent(hash.slice(base.length + 1));
      return param ? { id, param } : { id };
    }
  }
  return DEFAULT_ROUTE;
}

export function navigate(id: RouteId, param?: string): void {
  window.location.hash = routeHref(id, param);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  return route;
}
