import { useEffect, useMemo, useState } from 'preact/hooks';
import { BackLink } from '../components/BackLink';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { CoverImage } from '../components/CoverImage';
import { EmptyState } from '../components/EmptyState';
import { ChevronDownIcon, CloseIcon, LibraryIcon, PinIcon, SearchIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { BackupError, Reading, SharedPlace } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { firstPresentCopy, matchesPlace, matchesQuery, matchesStatus, toEntries, type LibraryEntry, type StatusFilter } from '../library/filter';
import { ALL_PLACES, hasPlace, placeFilter, placeFilterLabel, placeFilterParts, type PlaceValue } from '../library/placeFilter';
import { PlaceFilterSheet } from '../library/PlaceFilterSheet';
import type { PlaceIndex } from '../places/places';
import { navigate, routeHref } from '../router';
import { leaveSharedPlace, refreshPlaceNow, reopenPlace, takeOpeningResult, type OpeningResult } from '../sharing/guest';
import { sharedPlaceIndex } from '../sharing/sharedLibrary';
import { formatDateTime, formatNumber, fr } from '../textes/fr';

const OPENING_TEXTS: Record<OpeningResult, string> = {
  none: '',
  opened: fr.sharing.opened,
  cancelled: fr.sharing.cancelled,
  notPicked: fr.sharing.notPicked,
  failed: fr.sharing.openFailed,
};

const ERROR_TEXTS: Record<BackupError, string> = {
  offline: fr.sharing.placeErrorOffline,
  refused: fr.sharing.placeErrorRefused,
  failed: fr.sharing.placeErrorFailed,
};

interface Filters {
  query: string;
  place: PlaceValue;
  status: StatusFilter;
}

// Kept while the app is open, place by place: coming back from a book finds the same list.
const savedFilters = new Map<string, Filters>();
const NO_FILTERS: Filters = { query: '', place: ALL_PLACES, status: 'all' };

const PAGE_SIZE = 150;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: fr.library.filterAll },
  { id: 'toread', label: fr.library.filterToRead },
  { id: 'read', label: fr.library.filterRead },
];

interface PlaceData {
  place: SharedPlace | undefined;
  readings: Reading[];
}

/**
 * A place shared with the user (lot 13): its books, searched and filtered as in the library, with the
 * user's own readings; nothing of the place can be changed.
 */
export function SharedPlaceScreen({ fileId }: { fileId: string }) {
  const data = useLiveQuery<PlaceData | undefined>(
    async () => ({ place: await db.sharedPlaces.get(fileId), readings: await db.readings.toArray() }),
    [fileId],
    undefined,
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Return from Google's file picker.
  useEffect(() => {
    const result = takeOpeningResult();
    if (!result) return;
    setMessage(fr.sharing.opening);
    void result.then((value) => {
      setMessage(OPENING_TEXTS[value]);
    });
  }, []);

  if (!data) return <main class="screen" />;
  const { place } = data;
  if (!place) {
    return (
      <Screen title={fr.sharing.libraryTitle}>
        <BackLink href={routeHref('library')} label={fr.sharing.placeBack} />
        <p class="status-line" role="status">
          {message}
        </p>
        {!message && <p class="screen__intro">{fr.sharing.notFound}</p>}
      </Screen>
    );
  }

  const owner = place.owner || fr.sharing.someone;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const leave = (
    <button
      type="button"
      class="button button--secondary button--large"
      disabled={busy}
      onClick={() => {
        setConfirmLeave(true);
      }}
    >
      {fr.sharing.leave}
    </button>
  );

  return (
    <Screen
      title={place.name}
      kicker={fr.sharing.sharedBy(owner)}
      subtitle={place.contents ? fr.library.summary(place.contents.books.length) : undefined}
    >
      <BackLink href={routeHref('library')} label={fr.sharing.placeBack} />
      <p class="status-line" role="status">
        {message}
      </p>

      {place.endedAt !== undefined ? (
        <>
          <p class="screen__intro">{fr.sharing.endedText(place.name)}</p>
          <button
            type="button"
            class="button button--secondary button--large"
            onClick={() => {
              void leaveSharedPlace(fileId).then(() => {
                navigate('library');
              });
            }}
          >
            {fr.common.close}
          </button>
        </>
      ) : place.contents ? (
        <SharedBooks place={place} readings={data.readings} />
      ) : (
        <p class="screen__intro">{fr.sharing.waiting}</p>
      )}

      {place.endedAt === undefined && (
        <div class="backup__actions">
          {place.updatedAt !== undefined && (
            <p class="field__hint">{fr.sharing.placeUpdated(formatDateTime(new Date(place.updatedAt), new Date()))}</p>
          )}
          {place.lastError && <p class="field__hint">{ERROR_TEXTS[place.lastError]}</p>}
          {(!place.refreshToken || place.lastError === 'refused') && (
            <button type="button" class="button button--primary button--large" disabled={busy} onClick={() => void reopenPlace(fileId)}>
              {fr.sharing.reopen}
            </button>
          )}
          {place.refreshToken && (
            <button
              type="button"
              class="button button--secondary button--large"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setMessage(fr.sharing.refreshing);
                  await refreshPlaceNow(fileId);
                  const error = (await db.sharedPlaces.get(fileId))?.lastError;
                  setMessage(error ? ERROR_TEXTS[error] : fr.sharing.refreshed);
                })
              }
            >
              {fr.sharing.refresh}
            </button>
          )}
          {leave}
        </div>
      )}

      {confirmLeave && (
        <ConfirmSheet
          title={fr.sharing.leaveTitle}
          text={fr.sharing.leaveText(place.name)}
          confirm={fr.sharing.leaveConfirm}
          icon={<CloseIcon size={18} />}
          onConfirm={() => {
            setConfirmLeave(false);
            void leaveSharedPlace(fileId).then(() => {
              navigate('library');
            });
          }}
          onClose={() => {
            setConfirmLeave(false);
          }}
        />
      )}
    </Screen>
  );
}

/** The books of the place, as in the library: search, place filter, reading status. */
function SharedBooks({ place, readings }: { place: SharedPlace; readings: Reading[] }) {
  const { fileId, contents } = place;
  const entries = useMemo(() => (contents ? toEntries(contents.books, contents.copies, [], readings) : []), [contents, readings]);
  const places = useMemo(() => (contents ? sharedPlaceIndex(contents) : undefined), [contents]);
  const [filters, setFilters] = useState<Filters>(savedFilters.get(fileId) ?? NO_FILTERS);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [choosingPlace, setChoosingPlace] = useState(false);

  useEffect(() => {
    savedFilters.set(fileId, filters);
    setLimit(PAGE_SIZE);
  }, [fileId, filters]);

  const update = (changes: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...changes }));
  };

  const placeValue = places && !hasPlace(filters.place, places) ? ALL_PLACES : filters.place;
  const byPlaceAndQuery = useMemo(() => {
    if (!places) return [];
    const filter = placeFilter(placeValue, places);
    return entries.filter((entry) => matchesPlace(entry, filter) && matchesQuery(entry, filters.query));
  }, [entries, places, placeValue, filters.query]);
  const byQueryAndStatus = useMemo(
    () => entries.filter((entry) => matchesQuery(entry, filters.query) && matchesStatus(entry, filters.status)),
    [entries, filters.query, filters.status],
  );
  if (!contents || !places) return null;

  const shown = byPlaceAndQuery.filter((entry) => matchesStatus(entry, filters.status));
  const countOf = (value: PlaceValue) => {
    const filter = placeFilter(value, places);
    return byQueryAndStatus.filter((entry) => matchesPlace(entry, filter)).length;
  };

  return (
    <>
      {entries.length === 0 ? (
        <EmptyState icon={<LibraryIcon size={40} />} title={fr.sharing.placeEmpty} />
      ) : (
        <>
          <div class="search">
            <label class="visually-hidden" for="shared-search">
              {fr.library.searchLabel}
            </label>
            <span class="search__icon" aria-hidden="true">
              <SearchIcon size={20} />
            </span>
            <input
              id="shared-search"
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
                <span class="place-filter__text">
                  <span class="place-filter__main">{placeFilterParts(placeValue, places).main}</span>
                </span>
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
              onChange={(value) => {
                update({ place: value });
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
                <span class="chip__count">{formatNumber(byPlaceAndQuery.filter((entry) => matchesStatus(entry, id)).length)}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState icon={<SearchIcon size={40} />} title={fr.library.noMatchTitle} />
          ) : (
            <ul class="book-list">
              {shown.slice(0, limit).map((entry) => (
                <SharedBookRow key={entry.book.id} fileId={fileId} entry={entry} places={places} />
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
    </>
  );
}

function SharedBookRow({ fileId, entry, places }: { fileId: string; entry: LibraryEntry; places: PlaceIndex }) {
  const { book, reading, copies } = entry;
  const first = firstPresentCopy(entry);
  const place = first ? places.byShelfId.get(first.shelfId)?.roomLabel : copies.length > 0 ? fr.library.lost : undefined;
  const read = reading.status === 'read';
  return (
    <li>
      <a class="book-row" href={routeHref('sharedPlace', fileId, book.id)}>
        <CoverImage book={book} class="cover--list" sharedFileId={fileId} />
        <span class="book-row__text">
          <span class="book-row__title">{book.title || fr.common.untitled}</span>
          <span class="book-row__author">{book.authors.join(', ') || fr.common.unknownAuthor}</span>
          <span class="book-row__tags">
            <span class="tag">{place ?? fr.library.noPlace}</span>
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
