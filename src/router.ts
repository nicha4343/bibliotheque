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
  | 'check'
  | 'loans'
  | 'lend'
  | 'giveBack'
  | 'series'
  | 'author'
  | 'lists'
  | 'bookshop'
  | 'sharedList'
  | 'sharing'
  | 'invitation'
  | 'sharedPlace';

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
  /** Followed by LOAN_HISTORY for the returned loans. */
  loans: '#/prets',
  /** Scan of a book to lend (a lent book read is given back all the same). */
  lend: '#/preter',
  /** Scan of the books given back. */
  giveBack: '#/restituer',
  /** The series of the library, or one of them by its name. */
  series: '#/series',
  /** Followed by the author's name. */
  author: '#/auteur',
  /** Followed by one of LIST_TABS. */
  lists: '#/listes',
  /** « En librairie »: scan of books to check before buying them. */
  bookshop: '#/librairie',
  /** A wish list shared by link, followed by the list itself (see wishes/share.ts). */
  sharedList: '#/souhaits',
  /** Lot 13: the places shared with relatives, or one of them by its id. */
  sharing: '#/partage',
  /** Followed by the invitation sent by the owner of a place (see sharing/invitation.ts). */
  invitation: '#/invitation',
  /** A place shared with the user, by the id of its Drive file, then one of its notices. */
  sharedPlace: '#/lieu-partage',
};

/** Parameter of the loans route showing the history. */
export const LOAN_HISTORY = 'historique';

/** Tabs of the lists screen (screen 11). */
export const LIST_TABS = { wishes: 'souhaits', duplicates: 'doublons', insurance: 'assurance' } as const;
export type ListTab = keyof typeof LIST_TABS;

export function routeHref(id: RouteId, param?: string, detail?: string): string {
  if (!param) return ROUTE_HASHES[id];
  const path = `${ROUTE_HASHES[id]}/${encodeURIComponent(param)}`;
  return detail ? `${path}/${encodeURIComponent(detail)}` : path;
}

const DEFAULT_ROUTE: Route = { id: 'library' };
const ROUTE_IDS = Object.keys(ROUTE_HASHES) as RouteId[];

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

export function parseHash(hash: string): Route {
  for (const id of ROUTE_IDS) {
    const base = ROUTE_HASHES[id];
    if (hash === base) return { id };
    if (hash.startsWith(`${base}/`)) {
      const [param, detail] = hash
        .slice(base.length + 1)
        .split('/')
        .map(decode);
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

// Depth of the current entry in the history of the application, kept in the entry itself so that it
// survives a reload: « Retour » goes back only to a screen of the application.
let depth = 0;

const depthOf = (state: unknown): number | undefined => {
  const value = (state as { depth?: unknown } | null)?.depth;
  return typeof value === 'number' ? value : undefined;
};

function recordDepth(): void {
  const known = depthOf(window.history.state);
  if (known !== undefined) {
    depth = known;
    return;
  }
  // A new entry (a link followed); going back or forward finds the depth recorded before.
  depth += 1;
  window.history.replaceState({ ...(window.history.state as object | null), depth }, '');
}

export function startHistoryTracking(): void {
  const known = depthOf(window.history.state);
  if (known === undefined) window.history.replaceState({ ...(window.history.state as object | null), depth: 0 }, '');
  depth = known ?? 0;
  window.addEventListener('hashchange', recordDepth);
}

/** A screen of the application lies behind the current one. */
export const canGoBack = (): boolean => depth > 0;
