import { EmptyState } from '../components/EmptyState';
import { LibraryIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import { useLiveQuery } from '../db/useLiveQuery';
import { ROUTE_HASHES } from '../router';
import { fr } from '../textes/fr';

/** Screen 5. Lot 0: book count only; search, filters and list come with lot 1. */
export function LibraryScreen() {
  const bookCount = useLiveQuery<number | undefined>(() => db.books.count(), [], undefined);

  return (
    <Screen title={fr.library.title} subtitle={bookCount === undefined ? undefined : fr.library.summary(bookCount)}>
      {bookCount === 0 && (
        <EmptyState
          icon={<LibraryIcon size={40} />}
          title={fr.library.emptyTitle}
          text={fr.library.emptyText}
          action={
            <a class="button button--primary" href={ROUTE_HASHES.scan}>
              {fr.library.emptyAction}
            </a>
          }
        />
      )}
    </Screen>
  );
}
