import { db } from '../db/db';
import { useLiveQuery } from '../db/useLiveQuery';
import { ROUTE_HASHES, type RouteId } from '../router';
import { formatNumber, fr } from '../textes/fr';
import { LibraryIcon, PendingIcon, ScanIcon, SettingsIcon } from './icons';

const currentIf = (active: boolean) => (active ? 'page' : undefined);

export function NavBar({ current }: { current: RouteId }) {
  const pendingCount = useLiveQuery(() => db.pendingItems.count(), [], 0);

  return (
    <nav class="nav" aria-label={fr.nav.label}>
      <a class="nav__link" href={ROUTE_HASHES.library} aria-current={currentIf(current === 'library')}>
        <span class="nav__icon">
          <LibraryIcon />
        </span>
        {fr.nav.library}
      </a>
      <a class="nav__link nav__link--scan" href={ROUTE_HASHES.scan} aria-current={currentIf(current === 'scan')}>
        <span class="nav__scan-icon">
          <ScanIcon size={20} />
        </span>
        {fr.nav.scan}
      </a>
      <a class="nav__link" href={ROUTE_HASHES.pending} aria-current={currentIf(current === 'pending')}>
        <span class="nav__icon">
          <PendingIcon />
          {pendingCount > 0 && (
            <span class="nav__badge" aria-hidden="true">
              {pendingCount > 99 ? '99+' : formatNumber(pendingCount)}
            </span>
          )}
        </span>
        {fr.nav.pending}
        {pendingCount > 0 && <span class="visually-hidden"> {fr.nav.pendingBadge(pendingCount)}</span>}
      </a>
      <a class="nav__link" href={ROUTE_HASHES.settings} aria-current={currentIf(current === 'settings')}>
        <span class="nav__icon">
          <SettingsIcon />
        </span>
        {fr.nav.settings}
      </a>
    </nav>
  );
}
