import { useEffect, useState } from 'preact/hooks';

// Hash-based routes: they work on any static host and offline, without server-side rewrites.
export type RouteId =
  | 'library'
  | 'scan'
  | 'pending'
  | 'settings'
  | 'recap'
  | 'entry'
  | 'book'
  | 'places'
  | 'labels'
  | 'import'
  | 'backup'
  | 'shelves'
  | 'shelf'
  | 'check';

/** The four tabs of the navigation bar. */
export type TabId = 'library' | 'scan' | 'pending' | 'settings';

export interface Route {
  id: RouteId;
  /** Identifier following the route: a notice, an item to complete, a session, a shelf. */
  param?: string;
  /** Second identifier: the copy to point out on a shelf (« Où se trouve … ? »). */
  detail?: string;
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
  import: '#/importer',
  /** Also where Google's sign-in page sends the user back (see backup/google.ts). */
  backup: '#/sauvegarde',
  shelves: '#/etageres',
  /** Followed by the shelf's id, or by the token of its QR label (see scan/reads.ts). */
  shelf: '#/etagere',
  check: '#/verifier',
};

export function routeHref(id: RouteId, param?: string, detail?: string): string {
  if (!param) return ROUTE_HASHES[id];
  const path = `${ROUTE_HASHES[id]}/${encodeURIComponent(param)}`;
  return detail ? `${path}/${encodeURIComponent(detail)}` : path;
}

const DEFAULT_ROUTE: Route = { id: 'library' };
const ROUTE_IDS = Object.keys(ROUTE_HASHES) as RouteId[];

export function parseHash(hash: string): Route {
  for (const id of ROUTE_IDS) {
    const base = ROUTE_HASHES[id];
    if (hash === base) return { id };
    if (hash.startsWith(`${base}/`)) {
      const [param, detail] = hash
        .slice(base.length + 1)
        .split('/')
        .map((part) => decodeURIComponent(part));
      const route: Route = { id };
      if (param) route.param = param;
      if (param && detail) route.detail = detail;
      return route;
    }
  }
  return DEFAULT_ROUTE;
}

export function navigate(id: RouteId, param?: string, detail?: string): void {
  window.location.hash = routeHref(id, param, detail);
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
