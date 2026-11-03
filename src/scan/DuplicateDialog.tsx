import { CopiesIcon, PinIcon } from '../components/icons';
import { CoverImage } from '../components/CoverImage';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Copy, ScanEntry } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import type { PlaceIndex } from '../places/places';
import { fr } from '../textes/fr';

interface DuplicateDialogProps {
  entry: ScanEntry;
  places: PlaceIndex;
  onAnswer: (addCopy: boolean) => void;
}

/**
 * « Ouvrage déjà possédé »: waits for an explicit answer. No automatic closing, no close button,
 * and a new scan does not answer it (reads are suspended meanwhile).
 */
export function DuplicateDialog({ entry, places, onAnswer }: DuplicateDialogProps) {
  const data = useLiveQuery(
    async () => {
      if (!entry.bookId) return undefined;
      const [book, copies] = await Promise.all([
        db.books.get(entry.bookId),
        db.copies.where('bookId').equals(entry.bookId).sortBy('addedAt'),
      ]);
      const loans = copies.length > 0 ? await db.loans.where('copyId').anyOf(copies.map((copy) => copy.id)).toArray() : [];
      const borrowers = new Map(loans.filter((loan) => loan.returnedAt === undefined).map((loan) => [loan.copyId, loan.borrower]));
      return { book, copies, borrowers };
    },
    [entry.bookId],
    undefined,
  );
  const book = data?.book;
  const copies = data?.copies ?? [];
  const here = places.byShelfId.get(entry.shelfId)?.label ?? '';
  const placeLabel = (copy: Copy) => {
    const label = places.byShelfId.get(copy.shelfId)?.label ?? fr.library.noPlace;
    const borrower = data?.borrowers.get(copy.id);
    if (borrower) return fr.duplicate.lentPlace(label, borrower);
    return copy.lostAt === undefined ? label : fr.duplicate.lostPlace(label);
  };
  const title = book?.title || fr.common.untitled;

  return (
    <Sheet title={title} showTitle={false}>
      <div class="duplicate">
        <div class="duplicate__book">
          <CoverImage book={book} class="cover--dialog" />
          <div class="duplicate__text">
            <p class="duplicate__flag">
              <CopiesIcon size={16} />
              {fr.duplicate.heading}
            </p>
            <p class="duplicate__title" aria-hidden="true">
              {title}
            </p>
            <p class="duplicate__author">{book?.authors.join(', ')}</p>
          </div>
        </div>

        <div class="duplicate__owned">
          <p class="duplicate__owned-label">{fr.duplicate.owned(copies.length)}</p>
          <ul class="duplicate__places">
            {copies.map((copy) => (
              <li key={copy.id} class="duplicate__place">
                <PinIcon size={16} />
                {placeLabel(copy)}
              </li>
            ))}
          </ul>
        </div>

        <div class="duplicate__actions">
          <button
            type="button"
            class="button button--primary button--tall"
            onClick={() => {
              onAnswer(true);
            }}
          >
            <span class="button__main">{fr.duplicate.add(fr.common.ordinal(copies.length + 1))}</span>
            <span class="button__detail">{fr.duplicate.willBePlaced(here)}</span>
          </button>
          <button
            type="button"
            class="button button--secondary button--large"
            onClick={() => {
              onAnswer(false);
            }}
          >
            {fr.duplicate.decline}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
