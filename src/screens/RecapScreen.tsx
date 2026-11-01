import { CheckIcon, ChevronRightIcon } from '../components/icons';
import { CoverImage } from '../components/CoverImage';
import { db } from '../db/db';
import type { Book, ScanSession } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, nextShelf } from '../places/places';
import { navigate, routeHref } from '../router';
import { countEntries, startSession } from '../scan/session';
import { useEffect } from 'preact/hooks';
import { formatDuration, formatNumber, fr } from '../textes/fr';

interface RecapData {
  session: ScanSession;
  counts: ScanSession['counts'];
  duration: number;
  latest: Book[];
  place: string;
  pendingCount: number;
}

async function loadRecap(sessionId: string | undefined): Promise<RecapData | null> {
  const session = sessionId
    ? await db.scanSessions.get(sessionId)
    : (await db.scanSessions.orderBy('startedAt').reverse().toArray()).find((s) => s.endedAt !== undefined);
  if (!session) return null;
  const entries = await db.scanEntries.where('sessionId').equals(session.id).sortBy('createdAt');
  const addedIds = entries
    .filter((entry) => entry.status === 'added' || entry.status === 'extraCopy')
    .map((entry) => entry.bookId)
    .filter((id): id is string => Boolean(id));
  const latestIds = [...new Set(addedIds.reverse())].slice(0, 6);
  const latest = (await db.books.bulkGet(latestIds)).filter((book): book is Book => Boolean(book));
  const places = await loadPlaces();
  const first = entries[0]?.createdAt ?? session.startedAt;
  return {
    session,
    // Searches still running when the session ended may have finished since.
    counts: countEntries(entries),
    duration: (session.endedAt ?? Date.now()) - first,
    latest,
    place: places.byShelfId.get(session.shelfId)?.label ?? '',
    pendingCount: await db.pendingItems.count(),
  };
}

/** Screen 2: end of a shelf. */
export function RecapScreen({ sessionId }: { sessionId?: string | undefined }) {
  const data = useLiveQuery<RecapData | null | undefined>(() => loadRecap(sessionId), [sessionId], undefined);
  const nextPlace = useLiveQuery(
    async () => {
      if (!data) return undefined;
      const shelf = await db.shelves.get(data.session.shelfId);
      if (!shelf) return undefined;
      const places = await loadPlaces();
      const siblings = places.shelvesByRoom.get(shelf.roomId) ?? [];
      const next = siblings[siblings.findIndex((s) => s.id === shelf.id) + 1];
      const room = places.byShelfId.get(shelf.id)?.room.name ?? '';
      return fr.places.label(room, next?.name ?? fr.places.defaultShelfName(siblings.length + 1));
    },
    [data?.session.id, data?.session.shelfId],
    undefined,
  );

  useEffect(() => {
    document.title = fr.app.documentTitle(fr.recap.title);
  }, []);

  if (data === undefined) return <main class="recap" />;
  if (data === null) {
    return (
      <main class="recap">
        <p class="recap__details">{fr.recap.noSession}</p>
        <a class="button button--secondary button--large" href={routeHref('library')}>
          {fr.recap.library}
        </a>
      </main>
    );
  }

  const goToNextShelf = async () => {
    const shelf = await nextShelf(data.session.shelfId);
    if (!shelf) return;
    await startSession(shelf.id);
    navigate('scan');
  };

  const { counts } = data;
  return (
    <main class="recap">
      <header class="recap__header">
        <span class="recap__badge">
          <CheckIcon size={28} />
        </span>
        <p class="recap__ended">{fr.recap.ended}</p>
        <h1 class="recap__title">{fr.recap.scanned(counts.scanned)}</h1>
        <p class="recap__details">{fr.recap.details(formatDuration(data.duration), data.place)}</p>
      </header>

      <dl class="recap__counts">
        <div class="recap__count">
          <dt class="recap__label">{fr.recap.added(counts.added)}</dt>
          <dd class="recap__value recap__value--ok">{formatNumber(counts.added)}</dd>
        </div>
        <div class="recap__count">
          <dt class="recap__label">{fr.recap.pending}</dt>
          <dd class="recap__value recap__value--pending">{formatNumber(counts.pending)}</dd>
        </div>
        <div class="recap__count">
          <dt class="recap__label">{fr.recap.extraCopies(counts.extraCopies)}</dt>
          <dd class="recap__value">{formatNumber(counts.extraCopies)}</dd>
        </div>
      </dl>

      {data.latest.length > 0 && (
        <section class="recap__latest" aria-labelledby="latest-title">
          <h2 class="recap__latest-title" id="latest-title">
            {fr.recap.latest}
          </h2>
          <ul class="recap__covers">
            {data.latest.map((book) => (
              <li key={book.id}>
                <a href={routeHref('book', book.id)} aria-label={book.title}>
                  <CoverImage book={book} class="cover--recap" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div class="recap__spacer" />

      <div class="recap__actions">
        <button type="button" class="next-shelf" onClick={() => void goToNextShelf()}>
          <span class="next-shelf__text">
            <span class="next-shelf__title">{fr.recap.nextShelf}</span>
            {nextPlace && <span class="next-shelf__detail">{fr.recap.nextShelfDetail(nextPlace)}</span>}
          </span>
          <ChevronRightIcon size={22} />
        </button>
        {data.pendingCount > 0 && (
          <a class="button button--secondary button--large button--split" href={routeHref('entry')}>
            <span>{fr.recap.completePending}</span>
            <span class="count-badge">{formatNumber(data.pendingCount)}</span>
          </a>
        )}
        <a class="text-button text-button--center" href={routeHref('library')}>
          {fr.recap.library}
        </a>
      </div>
    </main>
  );
}
