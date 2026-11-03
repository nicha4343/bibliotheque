import { useEffect, useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { ChevronLeftIcon, LoanIcon, ScanIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { Book, Copy, Id, Loan } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { foldText } from '../library/filter';
import { CourtesySheet } from '../loans/CourtesySheet';
import {
  calendarUrl,
  groupByBorrower,
  isActive,
  loanHistory,
  loanState,
  loanStateText,
  markDueLoansSeen,
  returnLoan,
  undoReturn,
} from '../loans/loans';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { LOAN_HISTORY, routeHref } from '../router';
import { formatNearDate, fr } from '../textes/fr';

interface LoansData {
  loans: Loan[];
  copies: Map<Id, Copy>;
  books: Map<Id, Book>;
  places: PlaceIndex;
}

async function loadLoans(): Promise<LoansData> {
  const [loans, places] = await Promise.all([db.loans.toArray(), loadPlaces()]);
  const copies = new Map<Id, Copy>();
  for (const copy of await db.copies.bulkGet([...new Set(loans.map((loan) => loan.copyId))])) if (copy) copies.set(copy.id, copy);
  const books = new Map<Id, Book>();
  for (const book of await db.books.bulkGet([...new Set([...copies.values()].map((copy) => copy.bookId))])) if (book) books.set(book.id, book);
  return { loans, copies, books, places };
}

const AVATAR_COLORS = 6;

/** The same person always gets the same colour. */
function avatarColor(name: string): number {
  let hash = 0;
  for (const char of foldText(name)) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  return hash % AVATAR_COLORS;
}

const initialOf = (name: string): string => (Array.from(name.trim())[0] ?? '').toLocaleUpperCase('fr');

interface GivenBack {
  loan: Loan;
  title: string;
}

/** Screen 10: loans in progress by borrower, late ones, « Restitué », the way to the history. */
export function LoansScreen() {
  const data = useLiveQuery<LoansData | undefined>(() => loadLoans(), [], undefined);
  const [message, setMessage] = useState('');
  const [givenBack, setGivenBack] = useState<GivenBack>();
  const [courtesy, setCourtesy] = useState<{ borrower: string; message: string }>();
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const now = new Date();

  // The loans due are shown here: the reminder of the library screen has done its work.
  useEffect(() => {
    void markDueLoansSeen();
  }, []);

  const active = data?.loans.filter(isActive) ?? [];
  const groups = groupByBorrower(active);
  const late = active.filter((loan) => loanState(loan, now) === 'late').length;

  const bookOf = (loan: Loan) => {
    const copy = data?.copies.get(loan.copyId);
    return copy ? data?.books.get(copy.bookId) : undefined;
  };
  const titleOf = (loan: Loan) => bookOf(loan)?.title || fr.common.untitled;

  const giveBack = async (loan: Loan) => {
    const done = await returnLoan(loan.id);
    if (!done) return;
    const copy = data?.copies.get(loan.copyId);
    const place = (copy && data?.places.byShelfId.get(copy.shelfId)?.label) ?? fr.library.noPlace;
    setMessage(fr.loans.givenBack(titleOf(loan), place));
    setGivenBack({ loan, title: titleOf(loan) });
  };

  const undo = async () => {
    if (!givenBack) return;
    setGivenBack(undefined);
    setMessage((await undoReturn(givenBack.loan.id)) ? fr.loans.undone(givenBack.title) : fr.lendScan.undoFailed);
  };

  return (
    <Screen title={fr.loans.title} subtitle={data && fr.loans.summary(active.length, late)}>
      <div class="back-bar">
        <a class="text-button back-bar__link" href={routeHref('library')}>
          <ChevronLeftIcon size={20} />
          {fr.loans.back}
        </a>
      </div>

      <a class="lend-start" href={routeHref('lend')}>
        <ScanIcon size={24} />
        <span class="lend-start__text">
          <span class="lend-start__title">{fr.loans.lend}</span>
          <span class="lend-start__detail">{fr.loans.lendDetail}</span>
        </span>
      </a>
      {active.length > 0 && (
        <a class="lend-start lend-start--return" href={routeHref('giveBack')}>
          <LoanIcon size={24} />
          <span class="lend-start__text">
            <span class="lend-start__title">{fr.loans.giveBackStart}</span>
            <span class="lend-start__detail">{fr.loans.giveBackStartDetail}</span>
          </span>
        </a>
      )}

      <p class="status-line status-line--with-action" role="status">
        {message && <span>{message}</span>}
        {givenBack && (
          <button type="button" class="text-button" onClick={() => void undo()}>
            {fr.loans.undo}
          </button>
        )}
      </p>

      {data && groups.length === 0 && <p class="screen__intro">{fr.loans.empty}</p>}

      {data &&
        groups.map((group, index) => {
          const groupId = `borrower-${index}`;
          return (
            <section key={group.borrower} class="card loan-group" aria-labelledby={groupId}>
              <div class="loan-group__head">
                <span class={`avatar avatar--${avatarColor(group.borrower)}`} aria-hidden="true">
                  {initialOf(group.borrower)}
                </span>
                <span class="loan-group__text">
                  <h2 class="loan-group__name" id={groupId}>
                    {group.borrower}
                  </h2>
                  <span class="loan-group__count">{fr.loans.books(group.loans.length)}</span>
                </span>
              </div>
              <ul class="loan-list">
                {group.loans.map((loan) => {
                  const book = bookOf(loan);
                  const state = loanState(loan, now);
                  return (
                    <li key={loan.id} class="loan">
                      <CoverImage book={book} class="cover--row" />
                      <span class="loan__text">
                        {book ? (
                          <a class="loan__title" href={routeHref('book', book.id)}>
                            {titleOf(loan)}
                          </a>
                        ) : (
                          <span class="loan__title">{titleOf(loan)}</span>
                        )}
                        <span class="loan__detail">{fr.loans.lentOn(formatNearDate(new Date(loan.lentAt), now))}</span>
                        <span class={state === 'running' ? 'loan__state' : 'loan__state loan__state--late'}>
                          {loanStateText(loan, now)}
                        </span>
                        {state !== 'running' && (
                          <button
                            type="button"
                            class="text-button loan__courtesy"
                            onClick={() => {
                              setCourtesy({
                                borrower: group.borrower,
                                message: fr.courtesy.message(group.borrower, titleOf(loan), formatNearDate(new Date(loan.lentAt), now)),
                              });
                            }}
                          >
                            {fr.loans.courtesy(group.borrower)}
                          </button>
                        )}
                        {settings.loanCalendar && (
                          <a
                            class="text-button loan__courtesy"
                            href={calendarUrl(loan, titleOf(loan))}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={fr.loanReminders.addToCalendarLabel(titleOf(loan))}
                          >
                            {fr.loanReminders.addToCalendar}
                          </a>
                        )}
                      </span>
                      <button
                        type="button"
                        class="button button--secondary button--compact loan__back"
                        aria-label={fr.loans.giveBackLabel(titleOf(loan), group.borrower)}
                        onClick={() => void giveBack(loan)}
                      >
                        {fr.loans.giveBack}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

      {data && data.loans.length > active.length && (
        <a class="text-button text-button--center" href={routeHref('loans', LOAN_HISTORY)}>
          {fr.loans.history}
        </a>
      )}

      {courtesy && (
        <CourtesySheet
          borrower={courtesy.borrower}
          message={courtesy.message}
          onClose={() => {
            setCourtesy(undefined);
          }}
        />
      )}
    </Screen>
  );
}

/** « Historique des prêts »: loans given back, the most recent first. */
export function LoanHistoryScreen() {
  const data = useLiveQuery<LoansData | undefined>(() => loadLoans(), [], undefined);
  const history = data ? loanHistory(data.loans) : [];
  const now = new Date();

  return (
    <Screen title={fr.loanHistory.title} subtitle={data && fr.loanHistory.summary(history.length)}>
      <div class="back-bar">
        <a class="text-button back-bar__link" href={routeHref('loans')}>
          <ChevronLeftIcon size={20} />
          {fr.loanHistory.back}
        </a>
      </div>

      {data && history.length === 0 && <p class="screen__intro">{fr.loanHistory.empty}</p>}

      {history.length > 0 && (
        <ul class="card loan-list">
          {history.map((loan) => {
            const copy = data?.copies.get(loan.copyId);
            const book = copy ? data?.books.get(copy.bookId) : undefined;
            const title = book ? book.title || fr.common.untitled : fr.loanHistory.removed;
            return (
              <li key={loan.id} class="loan">
                <CoverImage book={book} class="cover--row" />
                <span class="loan__text">
                  {book ? (
                    <a class="loan__title" href={routeHref('book', book.id)}>
                      {title}
                    </a>
                  ) : (
                    <span class="loan__title">{title}</span>
                  )}
                  <span class="loan__detail">
                    {fr.loanHistory.period(
                      loan.borrower,
                      formatNearDate(new Date(loan.lentAt), now),
                      formatNearDate(new Date(loan.returnedAt ?? loan.lentAt), now),
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
