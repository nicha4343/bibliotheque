import { useEffect, useRef, useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { PlusIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Book, Copy, Loan } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import type { PlaceIndex } from '../places/places';
import { fr } from '../textes/fr';
import { DEFAULT_LOAN_DURATION, knownBorrowers, lendCopy, LOAN_DURATIONS, matchBorrower, type LoanDuration } from './loans';

interface LendSheetProps {
  book: Book;
  /** Copies that may be lent, the best first: a choice is offered when there are several. */
  copies: Copy[];
  places: PlaceIndex;
  /** Opened by the lending scan: « Scanné à l’instant ». */
  scanned?: boolean;
  /** Choices of the previous loan of the same scan, for several books lent to one person. */
  initialBorrower?: string | undefined;
  initialDuration?: LoanDuration | undefined;
  onLent: (loan: Loan, copy: Copy, duration: LoanDuration) => void;
  onClose: () => void;
}

/** « Prêter un ouvrage »: borrower (known or new) and duration. */
export function LendSheet({ book, copies, places, scanned, initialBorrower, initialDuration, onLent, onClose }: LendSheetProps) {
  const borrowers = useLiveQuery(async () => knownBorrowers(await db.loans.toArray()), [], []);
  const [copyId, setCopyId] = useState(copies[0]?.id);
  const [borrower, setBorrower] = useState(initialBorrower ?? '');
  const [newPerson, setNewPerson] = useState(false);
  const [typed, setTyped] = useState('');
  const [duration, setDuration] = useState<LoanDuration>(initialDuration ?? DEFAULT_LOAN_DURATION);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // The field appears on request: it is typed in at once.
  useEffect(() => {
    if (newPerson) nameRef.current?.focus();
  }, [newPerson]);

  const copy = copies.find((item) => item.id === copyId) ?? copies[0];
  const placeOf = (item: Copy) => {
    const label = places.byShelfId.get(item.shelfId)?.label ?? fr.library.noPlace;
    return item.lostAt === undefined ? label : fr.duplicate.lostPlace(label);
  };
  const name = newPerson ? matchBorrower(typed, borrowers) : borrower;
  const shown = initialBorrower && !borrowers.includes(initialBorrower) ? [initialBorrower, ...borrowers] : borrowers;
  const title = book.title || fr.common.untitled;

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!copy || !name || busy) return;
    setBusy(true);
    const loan = await lendCopy(copy.id, name, duration);
    setBusy(false);
    if (loan) onLent(loan, copy, duration);
    else setError(fr.lend.failed);
  };

  return (
    <Sheet title={fr.lend.title} onClose={onClose}>
      <form class="sheet__form" onSubmit={(event) => void submit(event)} noValidate>
        <div class="lend__book">
          <CoverImage book={book} class="cover--list" />
          <div class="lend__text">
            {scanned && <p class="lend__flag">{fr.lend.scanned}</p>}
            <p class="lend__title">{title}</p>
            <p class="lend__detail">
              {[book.authors.join(', '), copies.length === 1 && copy ? placeOf(copy) : undefined].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {copies.length > 1 && (
          <fieldset class="lend__group">
            <legend class="sheet__label">{fr.lend.copy}</legend>
            <div class="chips chips--wrap">
              {copies.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  class="chip chip--large"
                  aria-pressed={item.id === copy?.id}
                  onClick={() => {
                    setCopyId(item.id);
                  }}
                >
                  {placeOf(item)}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset class="lend__group">
          <legend class="sheet__label">{fr.lend.borrower}</legend>
          <div class="chips chips--wrap">
            {shown.map((person) => (
              <button
                key={person}
                type="button"
                class="chip chip--large"
                aria-pressed={!newPerson && person === borrower}
                onClick={() => {
                  setBorrower(person);
                  setNewPerson(false);
                  setError('');
                }}
              >
                {person}
              </button>
            ))}
            <button
              type="button"
              class="chip chip--large chip--add"
              aria-pressed={newPerson}
              onClick={() => {
                setNewPerson(true);
                setError('');
              }}
            >
              <PlusIcon size={16} />
              {fr.lend.newPerson}
            </button>
          </div>
          {newPerson && (
            <div class="field">
              <label class="field__label" for="lend-name">
                {fr.lend.nameLabel}
              </label>
              <input
                id="lend-name"
                ref={nameRef}
                class="field__input"
                type="text"
                value={typed}
                placeholder={fr.lend.namePlaceholder}
                autocomplete="off"
                autocapitalize="words"
                enterKeyHint="done"
                onInput={(event) => {
                  setTyped(event.currentTarget.value);
                }}
              />
            </div>
          )}
        </fieldset>

        <fieldset class="lend__group">
          <legend class="sheet__label">{fr.lend.duration}</legend>
          <div class="chips chips--wrap">
            {LOAN_DURATIONS.map((item) => (
              <button
                key={item}
                type="button"
                class="chip chip--large"
                aria-pressed={item === duration}
                onClick={() => {
                  setDuration(item);
                }}
              >
                {fr.lend.durations[item]}
              </button>
            ))}
          </div>
        </fieldset>

        {error && (
          <p class="field__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="button button--primary button--large" disabled={!name || !copy || busy}>
          {name ? fr.lend.confirm(name) : fr.lend.chooseBorrower}
        </button>
      </form>
    </Sheet>
  );
}
