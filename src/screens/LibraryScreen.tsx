import { useEffect, useMemo, useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { EmptyState } from '../components/EmptyState';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  LibraryIcon,
  ListIcon,
  LoanIcon,
  PinIcon,
  SearchIcon,
  SeriesIcon,
  ShelfIcon,
} from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { SharedPlace } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import {
  firstPresentCopy,
  matchesPlace,
  matchesQuery,
  matchesStatus,
  toEntries,
  type LibraryEntry,

  type StatusFilter,
} from '../library/filter';
import { dueLoans, markDueLoansSeen, unseenDueLoans } from '../loans/loans';
import { ALL_PLACES, hasPlace, placeFilter, placeFilterLabel, placeFilterParts, type PlaceValue } from '../library/placeFilter';
import { PlaceFilterSheet } from '../library/PlaceFilterSheet';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { ROUTE_HASHES, routeHref } from '../router';
import { seriesOf } from '../series/series';
import { loadSharedPlaces } from '../sharing/sharedLibrary';
import { formatNumber, fr } from '../textes/fr';

interface LibraryData {
  entries: LibraryEntry[];
  places: PlaceIndex;
  /** Loans whose return day has come: the number shown on the « Prêts » shortcut. */
  due: number;
  /** Those not yet seen: the reminder at the top of the screen. */
  reminders: Reminder[];
  /** At least one series is known: the « Séries » shortcut is shown. */
  hasSeries: boolean;
  /** Lot 13: the places shared with the user. */
  shared: SharedPlace[];
}

interface Reminder {
  title: string;
  borrower: string;
}

async function loadLibrary(): Promise<LibraryData> {
  const [books, copies, places, loans, readings, shared] = await Promise.all([
    db.books.toArray(),
    db.copies.toArray(),
    loadPlaces(),
    db.loans.toArray(),
    db.readings.toArray(),
    loadSharedPlaces(),
  ]);
  const now = new Date();
  const titles = new Map(books.map((book) => [book.id, book.title]));
  const bookOfCopy = new Map(copies.map((copy) => [copy.id, copy.bookId]));
  return {
    entries: toEntries(books, copies, loans, readings),
    places,
    due: dueLoans(loans, now).length,
    reminders: unseenDueLoans(loans, now).map((loan) => ({
      title: titles.get(bookOfCopy.get(loan.copyId) ?? '') || fr.common.untitled,
      borrower: loan.borrower,
    })),
    hasSeries: books.some((book) => seriesOf(book) !== undefined),
    shared,
  };
}

interface Filters {
  query: string;
  place: PlaceValue;
  status: StatusFilter;
}

// Kept while the app is open: coming back from a book sheet finds the same list.
let savedFilters: Filters = { query: '', place: ALL_PLACES, status: 'all' };

const PAGE_SIZE = 150;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: fr.library.filterAll },
  { id: 'toread', label: fr.library.filterToRead },
  { id: 'read', label: fr.library.filterRead },
  { id: 'lent', label: fr.library.filterLent },
];

/** Screen 5: instant local search, filters by place and reading status. */
export function LibraryScreen() {
  const data = useLiveQuery<LibraryData | undefined>(() => loadLibrary(), [], undefined);
  const [filters, setFilters] = useState<Filters>(savedFilters);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [choosingPlace, setChoosingPlace] = useState(false);

  useEffect(() => {
    savedFilters = filters;
    setLimit(PAGE_SIZE);
  }, [filters]);

  const update = (changes: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...changes }));
  };

  const places = data?.places;
  // The place chosen may have been deleted meanwhile.
  const placeValue = places && !hasPlace(filters.place, places) ? ALL_PLACES : filters.place;
  const byPlaceAndQuery = useMemo(() => {
    if (!data) return [];
    const place = placeFilter(placeValue, data.places);
    return data.entries.filter((entry) => matchesPlace(entry, place) && matchesQuery(entry, filters.query));
  }, [data, placeValue, filters.query]);
  const shown = byPlaceAndQuery.filter((entry) => matchesStatus(entry, filters.status));
  const filtered = filters.query.trim() !== '' || placeValue !== ALL_PLACES || filters.status !== 'all';
  // The numbers of the place filter: the search and the reading status chosen, in each place.
  const byQueryAndStatus = useMemo(
    () => (data ? data.entries.filter((entry) => matchesQuery(entry, filters.query) && matchesStatus(entry, filters.status)) : []),
    [data, filters.query, filters.status],
  );
  const countOf = (value: PlaceValue) => {
    if (!places) return 0;
    const place = placeFilter(value, places);
    return byQueryAndStatus.filter((entry) => matchesPlace(entry, place)).length;
  };

  const total = data?.entries.length;
  const subtitle = total === undefined ? undefined : filtered ? fr.library.results(shown.length) : fr.library.summary(total);

  return (
    <Screen title={fr.library.title} subtitle={subtitle}>
      {data && data.shared.length > 0 && <SharedPlaces places={data.shared} />}
      {total === 0 && (
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

      {data && places && total !== 0 && (
        <>
          {data.reminders.length > 0 && <LoanReminder reminders={data.reminders} />}
          <nav class="shortcuts" aria-label={fr.library.shortcuts}>
            {places.byShelfId.size > 0 && (
              <a class="shortcut" href={routeHref('shelves')}>
                <ShelfIcon size={22} />
                {fr.library.shelves}
              </a>
            )}
            {data.hasSeries && (
              <a class="shortcut" href={routeHref('series')}>
                <SeriesIcon size={22} />
                {fr.library.series}
              </a>
            )}
            <a class="shortcut" href={routeHref('loans')}>
              <LoanIcon size={22} />
              {fr.library.loans}
              {data.due > 0 && (
                <span class="shortcut__badge">
                  {formatNumber(data.due)}
                  <span class="visually-hidden"> {fr.library.loansDue(data.due)}</span>
                </span>
              )}
            </a>
            <a class="shortcut" href={routeHref('lists')}>
              <ListIcon size={22} />
              {fr.library.lists}
            </a>
          </nav>

          <div class="search">
            <label class="visually-hidden" for="library-search">
              {fr.library.searchLabel}
            </label>
            <span class="search__icon" aria-hidden="true">
              <SearchIcon size={20} />
            </span>
            <input
              id="library-search"
              class="field__input search__input"
              type="search"
              value={filters.query}
              placeholder={fr.library.searchPlaceholder}
              autocomplete="off"
              enterKeyHint="search"
              onInput={(event) => {
                update({ query: event.currentTarget.value });
              }}
            />
            {filters.query && (
              <button
                type="button"
                class="icon-button search__clear"
                aria-label={fr.library.clearSearch}
                onClick={() => {
                  update({ query: '' });
                }}
              >
                <CloseIcon size={18} />
              </button>
            )}
          </div>

          {places.rooms.length > 0 && (
            <div class={placeValue === ALL_PLACES ? 'place-filter' : 'place-filter place-filter--active'}>
              <button
                type="button"
                class="field__input place-filter__button"
                aria-haspopup="dialog"
                aria-label={fr.library.placeButton(placeFilterLabel(placeValue, places))}
                onClick={() => {
                  setChoosingPlace(true);
                }}
              >
                <PinIcon size={18} />
                <PlaceFilterText {...placeFilterParts(placeValue, places)} />
                {placeValue === ALL_PLACES && <ChevronDownIcon size={18} />}
              </button>
              {placeValue !== ALL_PLACES && (
                <button
                  type="button"
                  class="icon-button place-filter__clear"
                  aria-label={fr.library.clearPlace}
                  onClick={() => {
                    update({ place: ALL_PLACES });
                  }}
                >
                  <CloseIcon size={18} />
                </button>
              )}
            </div>
          )}
          {choosingPlace && (
            <PlaceFilterSheet
              places={places}
              value={placeValue}
              onChange={(place) => {
                update({ place });
              }}
              countOf={countOf}
              onClose={() => {
                setChoosingPlace(false);
              }}
            />
          )}

          <div class="chips chips--wrap" role="group" aria-label={fr.library.statusFilters}>
            {STATUS_FILTERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                class="chip"
                aria-pressed={filters.status === id}
                onClick={() => {
                  update({ status: id });
                }}
              >
                {label}{' '}
                <span class="chip__count">
                  {formatNumber(byPlaceAndQuery.filter((entry) => matchesStatus(entry, id)).length)}
                </span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={40} />}
              title={fr.library.noMatchTitle}
              text={fr.library.noMatchText}
              action={
                <a class="button button--primary" href={ROUTE_HASHES.scan}>
                  {fr.library.noMatchAction}
                </a>
              }
            />
          ) : (
            <ul class="book-list">
              {shown.slice(0, limit).map((entry) => (
                <BookRow key={entry.book.id} entry={entry} places={places} />
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <button
              type="button"
              class="button button--secondary button--large"
              onClick={() => {
                setLimit((value) => value + PAGE_SIZE);
              }}
            >
              {fr.library.showMore(shown.length - limit)}
            </button>
          )}
        </>
      )}
    </Screen>
  );
}

/** The return day of a loan has come: shown until the user closes it or opens the loans screen. */
function LoanReminder({ reminders }: { reminders: Reminder[] }) {
  const [first] = reminders;
  const text =
    reminders.length === 1 && first ? fr.loanReminders.inAppOne(first.title, first.borrower) : fr.loanReminders.inAppMany(reminders.length);
  return (
    <div class="reminder">
      <a class="reminder__link" href={routeHref('loans')}>
        <LoanIcon size={22} />
        <span class="reminder__text">
          {text}
          <span class="reminder__action">{fr.loanReminders.see}</span>
        </span>
      </a>
      <button
        type="button"
        class="icon-button reminder__close"
        aria-label={fr.loanReminders.dismiss}
        onClick={() => void markDueLoansSeen()}
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
}


/** Lot 13: the places someone shares with the user, above the user's own library. */
function SharedPlaces({ places }: { places: SharedPlace[] }) {
  return (
    <section class="section" aria-labelledby="shared-places-title">
      <h2 class="section__title" id="shared-places-title">
        {fr.sharing.libraryTitle}
      </h2>
      <div class="card">
        {places.map((place) => {
          const owner = place.owner || fr.sharing.someone;
          const detail =
            place.endedAt !== undefined
              ? fr.sharing.ended
              : place.contents
                ? fr.sharing.libraryRow(owner, place.contents.books.length)
                : fr.sharing.libraryWaiting(owner);
          return (
            <a key={place.fileId} class="link-row link-row--detail" href={routeHref('sharedPlace', place.fileId)}>
              <span class="setting__text">
                <span class="setting__label">{place.name}</span>
                <span class="setting__detail">{detail}</span>
              </span>
              <ChevronRightIcon size={18} />
            </a>
          );
        })}
      </div>
    </section>
  );
}

function PlaceFilterText({ site, main }: { site?: string | undefined; main: string }) {
  return (
    <span class="place-filter__text">
      {site && <span class="place-filter__site">{site}</span>}
      <span class="place-filter__main">{main}</span>
    </span>
  );
}

function BookRow({ entry, places }: { entry: LibraryEntry; places: PlaceIndex }) {
  const { book, reading, copies, loans } = entry;
  const first = firstPresentCopy(entry);
  const place = first ? places.byShelfId.get(first.shelfId)?.label : copies.length > 0 ? fr.library.lost : undefined;
  const lentTo = loans[0]?.borrower;
  const read = reading.status === 'read';
  return (
    <li>
      <a class="book-row" href={routeHref('book', book.id)}>
        <CoverImage book={book} class="cover--list" />
        <span class="book-row__text">
          <span class="book-row__title">{book.title || fr.common.untitled}</span>
          <span class="book-row__author">{book.authors.join(', ') || fr.common.unknownAuthor}</span>
          <span class="book-row__tags">
            {lentTo ? (
              <span class="tag tag--pending">{fr.library.lentTo(lentTo)}</span>
            ) : (
              <span class="tag">{place ?? fr.library.noPlace}</span>
            )}
            {copies.length > 1 && <span class="tag tag--accent">{fr.library.copies(copies.length)}</span>}
            <span class={read ? 'book-row__status book-row__status--read' : 'book-row__status'}>
              {read ? fr.library.statusRead : fr.library.statusToRead}
            </span>
          </span>
        </span>
      </a>
    </li>
  );
}
