import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CoverImage, hash, placeholderColour } from '../components/CoverImage';
import { EmptyState } from '../components/EmptyState';
import { CheckIcon, ChevronLeftIcon, QrIcon, ScanIcon, SearchIcon, ShelfIcon } from '../components/icons';
import { db } from '../db/db';
import type { Book, CheckAnswer, Copy, Id, Settings, Shelf, ShelfCheck } from '../db/schema';
import { getSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { sortKey } from '../library/filter';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { navigate, routeHref } from '../router';
import { LocationPicker } from '../scan/LocationPicker';
import { getActiveSession, setSessionShelf, startSession } from '../scan/session';
import { answerCheck, dismissCheck, latestCheck } from '../shelves/check';
import { rankOf, sortByPosition } from '../shelves/order';
import { formatDateTime, fr } from '../textes/fr';

const isDefined = <T,>(value: T | undefined): value is T => value !== undefined;

interface ShelfData {
  shelf: Shelf | undefined;
  places: PlaceIndex;
  settings: Settings;
  /** Copies kept on the shelf, those declared lost included. */
  copies: Copy[];
  /** Copies named by the check or pointed out (some may be elsewhere), with every notice needed. */
  otherCopies: Map<Id, Copy>;
  books: Map<Id, Book>;
  lent: Set<Id>;
  check: ShelfCheck | undefined;
}

/** The shelf is named by its id, or by the token of its QR label scanned with the phone's camera. */
async function loadShelf(idOrToken: string, copyId: string | undefined): Promise<ShelfData> {
  const [places, settings] = await Promise.all([loadPlaces(), getSettings()]);
  const shelf = (await db.shelves.get(idOrToken)) ?? (await db.shelves.where('qrToken').equals(idOrToken).first());
  const empty = { places, settings, copies: [], otherCopies: new Map(), books: new Map(), lent: new Set<Id>(), check: undefined };
  if (!shelf) return { shelf, ...empty };
  const [copies, check] = await Promise.all([db.copies.where('shelfId').equals(shelf.id).toArray(), latestCheck(shelf.id)]);
  const result = check?.result;
  const named = [...(result?.missing ?? []), ...(result?.lent ?? []), ...(result?.misplaced.map((item) => item.copyId) ?? [])];
  if (copyId) named.push(copyId);
  const otherCopies = new Map((await db.copies.bulkGet(named)).filter(isDefined).map((copy) => [copy.id, copy]));
  const bookIds = new Set([...copies, ...otherCopies.values()].map((copy) => copy.bookId));
  for (const item of result?.notOwned ?? []) if (item.bookId) bookIds.add(item.bookId);
  const books = new Map((await db.books.bulkGet([...bookIds])).filter(isDefined).map((book) => [book.id, book]));
  const loans = copies.length > 0 ? await db.loans.where('copyId').anyOf(copies.map((copy) => copy.id)).toArray() : [];
  const lent = new Set(loans.filter((loan) => loan.returnedAt === undefined).map((loan) => loan.copyId));
  return { shelf, places, settings, copies, otherCopies, books, lent, check };
}

const titleOf = (book: Book | undefined) => book?.title || fr.common.untitled;

/** « Scanner des ouvrages sur cette étagère »: the scan resumes, or starts, on this shelf. */
async function scanOn(shelfId: Id): Promise<void> {
  const session = await getActiveSession();
  if (session) await setSessionShelf(session.id, shelfId);
  else await startSession(shelfId);
  navigate('scan');
}

/** Screen 8: the books of a shelf, in their order when it is remembered; « Où se trouve … ? »; checking. */
export function ShelfScreen({ shelfRef, copyId }: { shelfRef: string; copyId: string | undefined }) {
  const data = useLiveQuery<ShelfData | undefined>(() => loadShelf(shelfRef, copyId), [shelfRef, copyId], undefined);
  const highlightRef = useRef<HTMLAnchorElement>(null);
  const shelf = data?.shelf;
  const place = shelf ? data.places.byShelfId.get(shelf.id) : undefined;

  const loaded = Boolean(data);
  useEffect(() => {
    if (loaded) document.title = fr.app.documentTitle(place?.label ?? fr.shelves.title);
  }, [loaded, place?.label]);

  // The book pointed out is brought into view on the spines.
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [loaded, copyId]);

  if (!data) return <main class="screen" />;
  const pointed = copyId ? (data.otherCopies.get(copyId) ?? data.copies.find((copy) => copy.id === copyId)) : undefined;
  const pointedBook = pointed ? data.books.get(pointed.bookId) : undefined;
  const back = pointedBook ? (
    <a class="text-button back-bar__link" href={routeHref('book', pointedBook.id)}>
      <ChevronLeftIcon size={20} />
      {fr.shelf.backToBook}
    </a>
  ) : (
    <a class="text-button back-bar__link" href={routeHref('shelves')}>
      <ChevronLeftIcon size={20} />
      {fr.shelf.back}
    </a>
  );

  if (!shelf || !place) {
    return (
      <main class="screen">
        <div class="screen__inner">
          <div class="back-bar">{back}</div>
          <p class="screen__intro">{fr.shelf.notFound}</p>
        </div>
      </main>
    );
  }

  const { settings, books, lent, check } = data;
  const ordered = settings.rememberShelfOrder;
  const present = data.copies.filter((copy) => copy.lostAt === undefined && books.has(copy.bookId));
  const sorted = ordered
    ? sortByPosition(present)
    : [...present].sort((a, b) => sortKey(titleOf(books.get(a.bookId))).localeCompare(sortKey(titleOf(books.get(b.bookId))), 'fr'));
  const ranks = ordered ? rankOf(present) : new Map<Id, number>();
  const unknownPositions = ordered ? present.filter((copy) => copy.position === undefined).length : 0;
  const result = check?.endedAt !== undefined && !check.dismissed ? check.result : undefined;
  const missing = new Set(result?.missing.filter((id) => !check?.answers?.[id]) ?? []);
  // A check quit before any read is simply started again.
  const openCheck = check && check.endedAt === undefined && check.reads.length > 0 ? check : undefined;

  return (
    <main class="screen">
      <div class="screen__inner">
        <div class="back-bar">{back}</div>

        {pointed && pointedBook && (
          <Where copy={pointed} book={pointedBook} shelfId={shelf.id} places={data.places} rank={ordered ? ranks.get(pointed.id) : undefined} ordered={ordered} />
        )}

        <header class="shelf__header">
          <p class="shelf__room">{place.room.name}</p>
          <h1 class="shelf__title">{shelf.name}</h1>
          <p class="shelf__summary">
            {fr.shelf.books(present.length)}
            {present.length > 1 && ` · ${ordered ? fr.shelf.inOrder : fr.shelf.byTitle}`}
          </p>
        </header>

        {present.length === 0 ? (
          <EmptyState
            icon={<ShelfIcon size={40} />}
            title={fr.shelf.empty}
            action={
              <button type="button" class="button button--primary" onClick={() => void scanOn(shelf.id)}>
                <ScanIcon size={20} />
                {fr.shelf.scanHere}
              </button>
            }
          />
        ) : (
          <>
            {ordered && (
              <Spines
                copies={sorted}
                books={books}
                ranks={ranks}
                lent={lent}
                missing={missing}
                highlighted={pointed?.id}
                highlightRef={highlightRef}
              />
            )}
            {ordered && unknownPositions > 0 && <p class="sheet__hint">{fr.shelf.unknownPositions(unknownPositions)}</p>}
            {!ordered && <p class="sheet__hint">{fr.shelf.orderOff}</p>}

            {openCheck ? (
              <a class="button button--primary button--large" href={routeHref('check', shelf.id)}>
                <ScanIcon size={20} />
                {fr.shelf.resume(openCheck.reads.length)}
              </a>
            ) : (
              <a class="button button--primary button--tall" href={routeHref('check', shelf.id)}>
                <span class="button__main">{fr.shelf.verify}</span>
                <span class="button__detail">{fr.shelf.verifyDetail}</span>
              </a>
            )}
          </>
        )}

        {check && result && <CheckResult check={check} data={data} />}

        {sorted.length > 0 && (
          <ul class="book-list">
            {sorted.map((copy) => {
              const book = books.get(copy.bookId);
              const rank = ranks.get(copy.id);
              return (
                <li key={copy.id}>
                  <a
                    class={copy.id === pointed?.id ? 'book-row shelf-row shelf-row--pointed' : 'book-row shelf-row'}
                    href={routeHref('book', copy.bookId)}
                  >
                    {ordered && (
                      <span class="shelf-row__rank" aria-hidden="true">
                        {rank ?? ''}
                      </span>
                    )}
                    <CoverImage book={book} class="cover--list" />
                    <span class="book-row__text">
                      <span class="book-row__title">
                        {rank !== undefined && <span class="visually-hidden">{fr.shelf.positionPrefix(fr.common.ordinalFeminine(rank))} </span>}
                        {titleOf(book)}
                      </span>
                      <span class="book-row__author">{book?.authors.join(', ') || fr.common.unknownAuthor}</span>
                      {(lent.has(copy.id) || missing.has(copy.id)) && (
                        <span class="book-row__tags">
                          {lent.has(copy.id) && <span class="tag">{fr.shelf.lentTag}</span>}
                          {missing.has(copy.id) && <span class="tag tag--pending">{fr.shelf.missingTag}</span>}
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        <a class="button button--secondary button--large" href={routeHref('labels', shelf.id)}>
          <QrIcon size={20} />
          {fr.shelf.printQr}
        </a>
      </div>
    </main>
  );
}

interface WhereProps {
  copy: Copy;
  book: Book;
  shelfId: Id;
  places: PlaceIndex;
  rank: number | undefined;
  ordered: boolean;
}

/** « Où se trouve … ? »: the place of the copy chosen on the book sheet, with its position. */
function Where({ copy, book, shelfId, places, rank, ordered }: WhereProps) {
  const label = places.byShelfId.get(copy.shelfId)?.label ?? fr.library.noPlace;
  let text = label;
  if (copy.lostAt !== undefined) text = fr.shelf.whereLost(label);
  else if (copy.shelfId === shelfId && ordered)
    text = rank === undefined ? fr.shelf.whereUnknown(label) : fr.shelf.wherePosition(label, fr.common.ordinalFeminine(rank));
  return (
    <div class="where" role="status">
      <SearchIcon size={22} />
      <p class="where__text">
        <span class="where__question">{fr.shelf.whereTitle(titleOf(book))}</span>
        <span class="where__answer">{text}</span>
      </p>
    </div>
  );
}

interface SpinesProps {
  copies: Copy[];
  books: Map<Id, Book>;
  ranks: Map<Id, number>;
  lent: Set<Id>;
  missing: Set<Id>;
  highlighted: Id | undefined;
  highlightRef: RefObject<HTMLAnchorElement | null>;
}

/** The shelf drawn as spines from left to right; width and height vary with the book, for the look. */
function Spines({ copies, books, ranks, lent, missing, highlighted, highlightRef }: SpinesProps) {
  return (
    <div class="spines" role="group" aria-label={fr.shelf.spines}>
      <div class="spines__row">
        {copies.map((copy) => {
          const book = books.get(copy.bookId);
          const title = titleOf(book);
          const seed = hash(copy.bookId);
          const rank = ranks.get(copy.id);
          const isLent = lent.has(copy.id);
          const isMissing = missing.has(copy.id);
          const modifier = isMissing ? ' spine--missing' : isLent ? ' spine--lent' : '';
          return (
            <a
              key={copy.id}
              class={`spine${modifier}${copy.id === highlighted ? ' spine--pointed' : ''}`}
              href={routeHref('book', copy.bookId)}
              ref={copy.id === highlighted ? highlightRef : undefined}
              aria-label={rank === undefined ? title : fr.shelf.spine(fr.common.ordinalFeminine(rank), title)}
              style={{ width: `${27 + (seed % 15)}px` }}
            >
              <span class="spine__space">
                <span
                  class="spine__book"
                  style={{ height: `${126 + ((seed >>> 4) % 40)}px`, background: isLent || isMissing ? undefined : placeholderColour(title) }}
                >
                  <span class="spine__title">{isLent ? fr.shelf.lent(title) : title}</span>
                  {isMissing && (
                    <span class="spine__flag" aria-hidden="true">
                      ?
                    </span>
                  )}
                </span>
              </span>
              <span class="spine__board" />
              <span class="spine__rank">{rank ?? ''}</span>
            </a>
          );
        })}
        <span class="spine spine--rest" aria-hidden="true">
          <span class="spine__space" />
          <span class="spine__board" />
          <span class="spine__rank" />
        </span>
      </div>
    </div>
  );
}

/** Text shown once a result has been answered, or changed elsewhere since the check. */
function answerText(answer: CheckAnswer | undefined, here: string, usual: string, places: PlaceIndex): string | undefined {
  switch (answer?.kind) {
    case undefined:
      return undefined;
    case 'movedHere':
      return fr.shelf.answerMoved(here);
    case 'toPutBack':
      return fr.shelf.answerPutBack(usual);
    case 'movedTo':
      return fr.shelf.answerMoved(places.byShelfId.get(answer.shelfId)?.label ?? fr.library.noPlace);
    case 'lost':
      return fr.shelf.answerLost;
    case 'added':
      return fr.shelf.answerAdded;
  }
}

interface Issue {
  key: string;
  title: string;
  isbn?: string | undefined;
  tag: string;
  tone: 'warn' | 'muted';
  text: string;
  resolved?: string | undefined;
  actions: { label: string; answer: CheckAnswer | 'pickShelf' }[];
}

/** Bilan of the last check: what is in place, what is missing, what is out of place. */
function CheckResult({ check, data }: { check: ShelfCheck; data: ShelfData }) {
  const [picking, setPicking] = useState<string>();
  const [failed, setFailed] = useState(false);
  const result = check.result;
  if (!result || !data.shelf) return null;
  const shelfId = data.shelf.id;
  const { places, books } = data;
  const here = places.byShelfId.get(shelfId)?.label ?? '';
  const labelOf = (id: Id) => places.byShelfId.get(id)?.label ?? fr.library.noPlace;
  const answers = check.answers ?? {};
  const issues: Issue[] = [];

  for (const id of result.missing) {
    const copy = data.otherCopies.get(id);
    if (!copy) continue;
    const answer = answers[id];
    // Moved or declared lost from the book sheet meanwhile.
    const changed = copy.shelfId !== shelfId ? fr.shelf.answerMoved(labelOf(copy.shelfId)) : copy.lostAt === undefined ? undefined : fr.shelf.answerLost;
    issues.push({
      key: id,
      title: titleOf(books.get(copy.bookId)),
      tag: fr.shelf.missingTag,
      tone: 'warn',
      text: fr.shelf.missingText,
      resolved: answerText(answer, here, '', places) ?? changed,
      actions: [
        { label: fr.shelf.storedElsewhere, answer: 'pickShelf' },
        { label: fr.shelf.declareLost, answer: { kind: 'lost' } },
      ],
    });
  }
  for (const item of result.misplaced) {
    const copy = data.otherCopies.get(item.copyId);
    if (!copy) continue;
    const usual = labelOf(item.shelfId);
    const changed = copy.shelfId === shelfId ? fr.shelf.answerMoved(here) : undefined;
    issues.push({
      key: item.copyId,
      title: titleOf(books.get(copy.bookId)),
      tag: fr.shelf.misplacedTag,
      tone: 'warn',
      text: fr.shelf.misplacedText(usual),
      resolved: answerText(answers[item.copyId], here, usual, places) ?? changed,
      actions: [
        { label: fr.shelf.moveHere, answer: { kind: 'movedHere' } },
        { label: fr.shelf.putBack, answer: { kind: 'toPutBack' } },
      ],
    });
  }
  for (const item of result.notOwned) {
    const book = item.bookId ? books.get(item.bookId) : undefined;
    issues.push({
      key: item.isbn13,
      title: book ? titleOf(book) : fr.shelf.notOwnedTitle,
      isbn: item.isbn13,
      tag: fr.shelf.notOwnedTag,
      tone: 'warn',
      text: fr.shelf.notOwnedText,
      resolved: answerText(answers[item.isbn13], here, '', places),
      actions: [{ label: fr.shelf.addHere, answer: { kind: 'added' } }],
    });
  }
  for (const id of result.lent) {
    const copy = data.otherCopies.get(id);
    if (!copy) continue;
    issues.push({ key: id, title: titleOf(books.get(copy.bookId)), tag: fr.shelf.lentTag, tone: 'muted', text: fr.shelf.lentText, actions: [] });
  }

  const answer = (key: string, value: CheckAnswer) => {
    void answerCheck(check.id, key, value).then((done) => {
      setFailed(!done);
    });
  };

  return (
    <section class="section check-result" aria-labelledby="check-result-title">
      <div class="check-result__header">
        <h2 class="section__title" id="check-result-title">
          {fr.shelf.resultTitle(formatDateTime(new Date(check.endedAt ?? check.startedAt)))}
        </h2>
        <button type="button" class="text-button" onClick={() => void dismissCheck(check.id)}>
          {fr.shelf.hideResult}
        </button>
      </div>
      <p class="check-result__ok">
        <CheckIcon size={20} />
        {fr.shelf.inPlace(result.inPlace.length)}
      </p>
      {issues.map((issue) => (
        <div key={issue.key} class="check-issue">
          <div class="check-issue__head">
            <p class="check-issue__title">
              {issue.title}
              {issue.isbn && <span class="check-issue__isbn mono">{issue.isbn}</span>}
            </p>
            <span class={`check-issue__tag check-issue__tag--${issue.tone}`}>{issue.tag}</span>
          </div>
          <p class="check-issue__text">{issue.text}</p>
          {issue.resolved ? (
            <p class="check-issue__resolved">{issue.resolved}</p>
          ) : (
            issue.actions.length > 0 && (
              <div class="check-issue__actions">
                {issue.actions.map(({ label, answer: value }, index) => (
                  <button
                    key={label}
                    type="button"
                    class={index === 0 ? 'button button--soft button--compact' : 'button button--secondary button--compact'}
                    onClick={() => {
                      if (value === 'pickShelf') setPicking(issue.key);
                      else answer(issue.key, value);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      ))}
      {result.unchecked.length > 0 && <p class="sheet__hint">{fr.shelf.unchecked(result.unchecked.length)}</p>}
      {failed && (
        <p class="status-line status-line--warn" role="status">
          {fr.shelf.answerFailed}
        </p>
      )}

      {picking && (
        <LocationPicker
          places={places}
          title={fr.shelf.storedElsewhereTitle}
          currentShelfId={shelfId}
          onPick={(picked) => {
            setPicking(undefined);
            answer(picking, { kind: 'movedTo', shelfId: picked.id });
          }}
          onClose={() => {
            setPicking(undefined);
          }}
        />
      )}
    </section>
  );
}
