import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BackLink } from '../components/BackLink';
import { CoverImage } from '../components/CoverImage';
import { EmptyState } from '../components/EmptyState';
import { CheckIcon, ChevronRightIcon, CloseIcon, HeartIcon, PlusIcon, SearchIcon, SeriesIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Book, Wish } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { foldText } from '../library/filter';
import {
  booksOfAuthor,
  catalogIsStale,
  catalogVolume,
  groupSeries,
  matchesSeries,
  seriesKey,
  seriesOf,
  volumeCells,
  volumeWish,
  type SeriesGroup,
} from '../series/series';
import { refreshCatalog, refreshCatalogs, setBookSeries, setSeriesTotal } from '../series/store';
import { routeHref } from '../router';
import { formatNumber, fr, joinWithAnd } from '../textes/fr';
import { toggleVolumeWish, wishMissingVolumes } from '../wishes/wishes';

const titleOf = (book: Book) => book.title || fr.common.untitled;

/**
 * The volumes owned are counted against the total only when it is known: declared by the user, found
 * at the BnF, or shown by a gap (volume 5 owned, not 4).
 */
const knowsTotal = (group: SeriesGroup): boolean =>
  group.total > 0 && (group.declaredTotal !== undefined || (group.catalog?.total ?? 0) > 0 || group.missing.length > 0);

type CatalogSearch = 'idle' | 'searching' | 'failed';

/** The BnF is asked for the volumes of the series when the page opens, at most once a week. */
function useCatalogSearch(group: SeriesGroup | undefined): CatalogSearch {
  const [status, setStatus] = useState<CatalogSearch>('idle');
  const stale = group ? catalogIsStale(group) : false;
  useEffect(() => {
    if (!group || !stale || !navigator.onLine) return;
    setStatus('searching');
    void refreshCatalog(group).then((done) => {
      setStatus(done ? 'idle' : 'failed');
    });
    // The group changes at each change of the library: only its key and staleness matter.
  }, [group?.key, stale]);
  return status;
}

/** « Nombre de tomes parus : 19, d’après la BnF ». */
function totalText(group: SeriesGroup, search: CatalogSearch): string {
  if (group.declaredTotal !== undefined) return fr.series.totalDeclared(group.declaredTotal);
  const found = group.catalog?.total ?? 0;
  if (found > 0) return fr.series.totalFound(found);
  if (search === 'searching') return fr.series.totalSearching;
  return group.catalog ? fr.series.totalNotFound : fr.series.totalUnknown;
}

/** « 5 sur 7 · 2 tomes manquants », or the number of notices when the total is unknown. */
export function seriesDetail(group: SeriesGroup): string {
  if (!knowsTotal(group)) return fr.series.rowBooks(group.volumes.length);
  const owned = fr.series.rowOwned(group.owned, group.total);
  return `${owned} · ${group.missing.length === 0 ? fr.series.complete : fr.series.rowMissing(group.missing.length)}`;
}

function missingText(missing: readonly number[]): string {
  const [first] = missing;
  if (missing.length === 1 && first !== undefined) return fr.series.missingOne(first);
  if (missing.length > 6) return fr.series.missingMany(missing.length);
  return fr.series.missingSome(joinWithAnd(missing.map(formatNumber)));
}

// Kept while the app is open: coming back from a series finds the same list.
let savedQuery = '';

/** « Séries », from the library: every series, leading to its page, with an instant local search. */
export function SeriesListScreen() {
  const groups = useLiveQuery<SeriesGroup[] | undefined>(
    async () => groupSeries(await db.books.toArray(), await db.series.toArray()),
    [],
    undefined,
  );
  const [query, setQuery] = useState(savedQuery);
  const searched = useRef(false);
  const shown = useMemo(() => groups?.filter((group) => matchesSeries(group, query)), [groups, query]);
  const search = (value: string) => {
    savedQuery = value;
    setQuery(value);
  };

  // Series not searched at the BnF for a week, one after the other, in the background.
  useEffect(() => {
    if (!groups || searched.current || !navigator.onLine) return;
    searched.current = true;
    void refreshCatalogs(groups);
  }, [groups]);

  return (
    <Screen
      title={fr.series.listTitle}
      subtitle={groups && fr.series.summary(groups.length)}
    >
      <BackLink href={routeHref('library')} label={fr.series.back} />
      {groups?.length === 0 && <EmptyState icon={<SeriesIcon size={40} />} title={fr.series.emptyTitle} text={fr.series.emptyText} />}
      {groups && groups.length > 0 && (
        <div class="search">
          <label class="visually-hidden" for="series-list-search">
            {fr.series.searchLabel}
          </label>
          <span class="search__icon" aria-hidden="true">
            <SearchIcon size={20} />
          </span>
          <input
            id="series-list-search"
            class="field__input search__input"
            type="search"
            value={query}
            placeholder={fr.series.searchPlaceholder}
            autocomplete="off"
            enterKeyHint="search"
            onInput={(event) => {
              search(event.currentTarget.value);
            }}
          />
          {query && (
            <button
              type="button"
              class="icon-button search__clear"
              aria-label={fr.series.clearSearch}
              onClick={() => {
                search('');
              }}
            >
              <CloseIcon size={18} />
            </button>
          )}
        </div>
      )}
      {groups && groups.length > 0 && shown?.length === 0 && (
        <EmptyState icon={<SearchIcon size={40} />} title={fr.series.noMatchTitle} text={fr.series.noMatchText} />
      )}
      {shown && shown.length > 0 && <SeriesLinks groups={shown} />}
    </Screen>
  );
}

function SeriesLinks({ groups }: { groups: readonly SeriesGroup[] }) {
  return (
    <div class="card">
      {groups.map((group) => (
        <a key={group.key} class="link-row link-row--detail" href={routeHref('series', group.name)}>
          <span class="setting__text">
            <span class="setting__label">{group.name}</span>
            <span class="setting__detail">{seriesDetail(group)}</span>
          </span>
          <ChevronRightIcon size={18} />
        </a>
      ))}
    </div>
  );
}

interface SeriesData {
  books: Book[];
  groups: SeriesGroup[];
  wishes: Wish[];
}

async function loadSeries(): Promise<SeriesData> {
  const [books, records, wishes] = await Promise.all([db.books.toArray(), db.series.toArray(), db.wishes.toArray()]);
  return { books, groups: groupSeries(books, records), wishes };
}

type Dialog = { kind: 'total' } | { kind: 'add' };

/** Screen 9: volumes owned and missing, wishes, the same author, the other series. */
export function SeriesScreen({ name }: { name: string }) {
  const data = useLiveQuery<SeriesData | undefined>(() => loadSeries(), [], undefined);
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState('');
  const key = seriesKey(name);
  const group = data?.groups.find((item) => item.key === key);
  const search = useCatalogSearch(group);
  const close = () => {
    setDialog(undefined);
  };

  if (!data) return <main class="screen" />;
  if (!group) {
    return (
      <Screen title={name}>
        <BackLink href={routeHref('series')} label={fr.series.listTitle} />
        <p class="screen__intro">{fr.series.notFound}</p>
      </Screen>
    );
  }

  const cells = volumeCells(group);
  const unnumbered = group.volumes.filter((volume) => volume.index === undefined);
  const missingWished = group.missing.filter((index) => volumeWish(data.wishes, key, index));
  const others = data.groups.filter((item) => item.key !== key);
  const byline = [group.authors.join(', '), group.publisher].filter(Boolean).join(' · ');

  return (
    <Screen
      title={group.name}
      subtitle={byline || undefined}
      kicker={fr.series.kicker}
    >
      <BackLink href={routeHref('series')} label={fr.series.listTitle} />
      <div class="series-progress">
        <div class="series-progress__head">
          <p class="series-progress__owned">
            {knowsTotal(group) ? fr.series.ownedOf(group.owned, group.total) : fr.series.ownedBooks(group.volumes.length)}
          </p>
          {group.missing.length > 0 && <p class="series-progress__missing">{missingText(group.missing)}</p>}
        </div>
        {knowsTotal(group) && (
          <div class="progress series-progress__bar" aria-hidden="true">
            <span class="progress__bar" style={{ width: `${(group.owned / group.total) * 100}%` }} />
          </div>
        )}
        <div class="series-progress__total">
          <span>{totalText(group, search)}</span>
          <button
            type="button"
            class="text-button"
            aria-label={fr.series.totalEditLabel}
            onClick={() => {
              setDialog({ kind: 'total' });
            }}
          >
            {fr.series.totalEdit}
          </button>
        </div>
      </div>

      {cells.length > 0 && (
        <section class="section" aria-labelledby="volumes-title">
          <h2 class="visually-hidden" id="volumes-title">
            {fr.series.volumes}
          </h2>
          <ul class="volumes">
            {cells.map((cell) => {
              if (cell.kind === 'owned') {
                return (
                  <li key={cell.book.id}>
                    <a class="volume" href={routeHref('book', cell.book.id)} aria-label={fr.series.volumeOwned(cell.index, titleOf(cell.book))}>
                      <span class="volume__cover">
                        <CoverImage book={cell.book} class="cover--volume" />
                        <span class="volume__number" aria-hidden="true">
                          {formatNumber(cell.index)}
                        </span>
                        <span class="volume__check" aria-hidden="true">
                          <CheckIcon size={14} />
                        </span>
                      </span>
                      <span class="volume__title" aria-hidden="true">
                        {titleOf(cell.book)}
                      </span>
                    </a>
                  </li>
                );
              }
              const wished = Boolean(volumeWish(data.wishes, key, cell.index));
              const listed = catalogVolume(group, cell.index)?.title;
              const label = listed
                ? wished
                  ? fr.series.volumeUnwishTitledLabel(cell.index, listed)
                  : fr.series.volumeWishTitledLabel(cell.index, listed)
                : wished
                  ? fr.series.volumeUnwishLabel(cell.index)
                  : fr.series.volumeWishLabel(cell.index);
              return (
                <li key={`missing-${cell.index}`}>
                  <button
                    type="button"
                    class={wished ? 'volume volume--missing volume--wished' : 'volume volume--missing'}
                    aria-pressed={wished}
                    aria-label={label}
                    onClick={() => void toggleVolumeWish(group, cell.index)}
                  >
                    <span class="volume__cover volume__cover--missing" aria-hidden="true">
                      <span class="volume__number">{formatNumber(cell.index)}</span>
                      <span class="volume__state">{wished ? fr.series.volumeWished : fr.series.volumeMissing}</span>
                    </span>
                    <span class="volume__title" aria-hidden="true">
                      {listed ?? fr.series.volume(cell.index)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {group.missing.length > 0 &&
        (missingWished.length === group.missing.length ? (
          <p class="status-line series__all-wished">
            <CheckIcon size={20} />
            {fr.series.allWished}
          </p>
        ) : (
          <button
            type="button"
            class="button button--primary button--large"
            onClick={() =>
              void wishMissingVolumes(group).then((added) => {
                setMessage(fr.series.addedMissing(added));
              })
            }
          >
            <HeartIcon size={20} />
            {fr.series.addMissing}
          </button>
        ))}

      {unnumbered.length > 0 && (
        <section class="section" aria-labelledby="unnumbered-title">
          <h2 class="section__title" id="unnumbered-title">
            {fr.series.unnumbered}
          </h2>
          <ul class="book-list">
            {unnumbered.map(({ book }) => (
              <li key={book.id}>
                <a class="book-row" href={routeHref('book', book.id)}>
                  <CoverImage book={book} class="cover--list" />
                  <span class="book-row__text">
                    <span class="book-row__title">{titleOf(book)}</span>
                    <span class="book-row__author">{book.authors.join(', ') || fr.common.unknownAuthor}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        class="button button--secondary button--large"
        onClick={() => {
          setDialog({ kind: 'add' });
        }}
      >
        <PlusIcon size={20} />
        {fr.series.addBook}
      </button>

      <p class="status-line" role="status">
        {message}
      </p>

      {group.authors.length > 0 && (
        <section class="section" aria-labelledby="same-author-title">
          <h2 class="section__title" id="same-author-title">
            {fr.series.sameAuthor}
          </h2>
          <div class="card">
            {group.authors.map((author) => (
              <a key={author} class="link-row link-row--detail" href={routeHref('author', author)}>
                <span class="setting__text">
                  <span class="setting__label">{author}</span>
                  <span class="setting__detail">{fr.series.authorRow(booksOfAuthor(data.books, author).length)}</span>
                </span>
                <ChevronRightIcon size={18} />
              </a>
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section class="section" aria-labelledby="other-series-title">
          <h2 class="section__title" id="other-series-title">
            {fr.series.otherSeries}
          </h2>
          <SeriesLinks groups={others} />
        </section>
      )}
      <p class="screen__intro">{fr.series.note}</p>

      {dialog?.kind === 'total' && <TotalSheet group={group} onClose={close} />}
      {dialog?.kind === 'add' && (
        <AddToSeriesSheet
          group={group}
          books={data.books}
          onAdded={(book) => {
            close();
            setMessage(fr.series.added(titleOf(book)));
          }}
          onClose={close}
        />
      )}
    </Screen>
  );
}

const MAX_TOTAL = 500;

/** « Nombre de tomes parus »: empty keeps the highest volume owned. */
function TotalSheet({ group, onClose }: { group: SeriesGroup; onClose: () => void }) {
  const [value, setValue] = useState(group.declaredTotal === undefined ? '' : String(group.declaredTotal));
  const [submitted, setSubmitted] = useState(false);
  const text = value.trim();
  const total = Number(text);
  const invalid = text !== '' && !(/^\d+$/.test(text) && total >= 1 && total <= MAX_TOTAL);

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    await setSeriesTotal(group.key, text === '' ? undefined : total);
    onClose();
  };

  return (
    <Sheet title={fr.series.totalTitle} onClose={onClose}>
      <form class="sheet__form" onSubmit={(event) => void submit(event)} noValidate>
        <div class="field">
          <label class="field__label" for="series-total">
            {fr.series.totalTitle}
          </label>
          <input
            id="series-total"
            class="field__input"
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={value}
            autocomplete="off"
            aria-describedby="series-total-hint"
            aria-invalid={submitted && invalid}
            onInput={(event) => {
              setValue(event.currentTarget.value);
            }}
          />
          <p class="field__hint" id="series-total-hint">
            {fr.series.totalHint}
          </p>
          {submitted && invalid && <p class="field__error">{fr.series.totalInvalid}</p>}
        </div>
        <button type="submit" class="button button--primary button--large">
          {fr.common.save}
        </button>
      </form>
    </Sheet>
  );
}

const MATCH_LIMIT = 30;

interface AddToSeriesProps {
  group: SeriesGroup;
  books: readonly Book[];
  onAdded: (book: Book) => void;
  onClose: () => void;
}

/** « Ajouter un ouvrage à cette série »: a notice of the library, with its volume number. */
function AddToSeriesSheet({ group, books, onAdded, onClose }: AddToSeriesProps) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Book>();
  const [volume, setVolume] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const candidates = useMemo(() => {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    return books
      .filter((book) => {
        const series = seriesOf(book);
        if (series && seriesKey(series.name) === group.key) return false;
        const text = foldText([book.title, ...book.authors].join(' '));
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
      .slice(0, MATCH_LIMIT);
  }, [books, group.key, query]);

  const choose = (book: Book) => {
    setChosen(book);
    const fromTitle = seriesOf(book)?.index;
    const next = fromTitle ?? group.missing[0] ?? (group.total > 0 ? group.total + 1 : undefined);
    setVolume(next === undefined ? '' : String(next));
  };

  const volumeText = volume.trim();
  const invalid = volumeText !== '' && !/^\d{1,4}$/.test(volumeText);

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (!chosen || invalid) return;
    await setBookSeries(chosen.id, group.name, volumeText === '' ? undefined : Number(volumeText));
    onAdded(chosen);
  };

  return (
    <Sheet title={fr.series.addTitle} onClose={onClose}>
      {chosen ? (
        <form class="sheet__form" onSubmit={(event) => void submit(event)} noValidate>
          <div class="lend__book">
            <CoverImage book={chosen} class="cover--list" />
            <div class="lend__text">
              <p class="lend__title">{titleOf(chosen)}</p>
              <p class="lend__detail">{chosen.authors.join(', ')}</p>
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="series-volume">
              {fr.series.addVolumeLabel}
            </label>
            <input
              id="series-volume"
              class="field__input"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={volume}
              autocomplete="off"
              aria-describedby="series-volume-hint"
              aria-invalid={submitted && invalid}
              onInput={(event) => {
                setVolume(event.currentTarget.value);
              }}
            />
            <p class="field__hint" id="series-volume-hint">
              {fr.series.addVolumeHint}
            </p>
            {submitted && invalid && <p class="field__error">{fr.book.volumeInvalid}</p>}
          </div>
          <button type="submit" class="button button--primary button--large">
            {fr.series.addConfirm}
          </button>
          <button
            type="button"
            class="button button--secondary button--large"
            onClick={() => {
              setChosen(undefined);
              setSubmitted(false);
            }}
          >
            {fr.series.addChange}
          </button>
        </form>
      ) : (
        <>
          <div class="field">
            <label class="field__label" for="series-search">
              {fr.series.addSearchLabel}
            </label>
            <input
              id="series-search"
              class="field__input"
              type="search"
              value={query}
              placeholder={fr.series.addSearchPlaceholder}
              autocomplete="off"
              onInput={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
          </div>
          {candidates.length === 0 ? (
            <p class="sheet__hint">{fr.series.addNoMatch}</p>
          ) : (
            <ul class="pick-list">
              {candidates.map((book) => {
                const current = seriesOf(book);
                return (
                  <li key={book.id}>
                    <button
                      type="button"
                      class="pick-list__item"
                      onClick={() => {
                        choose(book);
                      }}
                    >
                      <CoverImage book={book} class="cover--row" />
                      <span class="pick-list__text">
                        <span class="pick-list__title">{titleOf(book)}</span>
                        <span class="pick-list__detail">
                          {current ? fr.series.addInOther(current.name) : book.authors.join(', ') || fr.common.unknownAuthor}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}
