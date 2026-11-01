import { useEffect, useState } from 'preact/hooks';

// Hash-based routes: they work on any static host and offline, without server-side rewrites.
export type RouteId = 'library' | 'scan' | 'pending' | 'settings';

export const ROUTE_HASHES: Readonly<Record<RouteId, string>> = {
  library: '#/bibliotheque',
  scan: '#/scanner',
  pending: '#/a-completer',
  settings: '#/parametres',
};

const DEFAULT_ROUTE: RouteId = 'library';
const ROUTE_IDS = Object.keys(ROUTE_HASHES) as RouteId[];

export function routeFromHash(hash: string): RouteId {
  return ROUTE_IDS.find((id) => ROUTE_HASHES[id] === hash) ?? DEFAULT_ROUTE;
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => {
      setRoute(routeFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  return route;
}
