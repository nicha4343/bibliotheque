import { EmptyState } from '../components/EmptyState';
import { PendingIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import { useLiveQuery } from '../db/useLiveQuery';
import { fr } from '../textes/fr';

/** Screen 3. Lot 0: empty state only; the list comes with lot 1. */
export function PendingScreen() {
  const pendingCount = useLiveQuery<number | undefined>(() => db.pendingItems.count(), [], undefined);

  return (
    <Screen title={fr.pending.title}>
      {pendingCount === 0 && (
        <EmptyState icon={<PendingIcon size={40} />} title={fr.pending.emptyTitle} text={fr.pending.emptyText} />
      )}
    </Screen>
  );
}
