import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { CloseIcon, HeartIcon, ScanIcon } from '../components/icons';
import type { Book, BookMetadata, Cover, Id } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { LIST_TABS, navigate, routeHref } from '../router';
import type { DetectedCode } from '../scan/detector';
import { beep, vibrate, type Signal } from '../scan/feedback';
import { findMetadata } from '../scan/lookups';
import { classifyCode, RepeatFilter } from '../scan/reads';
import { useCamera, useCodeDetection } from '../scan/useCamera';
import { Viewfinder, type Flash } from '../scan/Viewfinder';
import { formatNumber, fr } from '../textes/fr';
import { loadBookshopCheck, loadBookshopDetails, loadCatalogMatch, type BookshopDetails, type BookshopVerdict } from '../wishes/bookshop';
import { addWish, removeWish } from '../wishes/wishes';

type RowKind = 'owned' | 'wished' | 'absent';

/** One book checked during this visit, newest first. */
interface Row {
  isbn13: string;
  kind: RowKind;
  /** What the cover shows: the notice, or the cover found by the sources. */
  book: Pick<Book, 'title' | 'cover'>;
  title: string;
  detail: string;
  /** Absent book: its metadata, once found, and the wish made of it during the visit. */
  metadata?: BookMetadata;
  details?: BookshopDetails;
  wishId?: Id;
}

const READY: Flash = { kind: 'info', text: fr.bookshop.ready };

function ownedDetail(verdict: Extract<BookshopVerdict, { kind: 'owned' }>, places: PlaceIndex | undefined): string {
  if (verdict.lentTo) return fr.bookshop.lentTo(verdict.lentTo);
  const present = verdict.copies.filter((copy) => copy.lostAt === undefined);
  const [first] = present;
  if (!first) return fr.bookshop.lost;
  const place = places?.byShelfId.get(first.shelfId)?.label ?? fr.library.noPlace;
  return present.length > 1 ? fr.bookshop.copies(present.length, place) : place;
}

function absentDetail(metadata: BookMetadata | undefined, details: BookshopDetails | undefined): string {
  const { group, series } = details ?? {};
  if (group && series?.index !== undefined && group.missing.includes(series.index)) return fr.bookshop.seriesMissing(group.name, series.index);
  if (group) return fr.bookshop.seriesOwned(group.name, group.volumes.length);
  return metadata?.authors?.join(', ') ?? '';
}

/**
 * « En librairie » (screen 11): each book read says at once whether it is already owned (attention
 * signal), wished, or absent; an absent book may be added to the wishes. Nothing else changes.
 */
export function BookshopScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => ({ video: videoRef, view: viewRef, aim: aimRef }), []);
  const camera = useCamera(videoRef);
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [flash, setFlash] = useState<Flash>(READY);
  const filter = useRef(new RepeatFilter()).current;
  const latest = useRef<string | undefined>(undefined);

  useEffect(() => {
    document.title = fr.app.documentTitle(fr.bookshop.title);
  }, []);

  const signal = (kind: Signal) => {
    if (settings.scanSound) beep(kind);
    if (settings.scanVibration) vibrate(kind);
  };

  const updateRow = (isbn13: string, changes: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.isbn13 === isbn13 ? { ...row, ...changes } : row)));
  };

  /** Title, author and series of an absent book, from the sources (or the cache). */
  const complete = async (isbn13: string, listed: boolean) => {
    const metadata = await findMetadata(isbn13, () => Promise.resolve()).catch(() => undefined);
    if (!metadata || metadata.providers.length === 0) {
      // A volume listed by the BnF keeps its title and series.
      if (!listed) updateRow(isbn13, { detail: metadata ? fr.bookshop.unknown : fr.bookshop.offline });
      return;
    }
    const details = await loadBookshopDetails(metadata);
    const title = metadata.title ?? isbn13;
    const coverUrl = metadata.coverUrls?.[0]?.url;
    const cover: Cover | undefined = coverUrl ? { source: 'auto', url: coverUrl } : undefined;
    const kind: RowKind = details.wish ? 'wished' : 'absent';
    const detail = kind === 'wished' ? (metadata.authors?.join(', ') ?? '') : absentDetail(metadata, details);
    updateRow(isbn13, { kind, title, detail, metadata, details, book: { title, cover } });
    if (latest.current !== isbn13) return;
    setFlash(kind === 'wished' ? { kind: 'ok', text: fr.bookshop.wished(title) } : { kind: 'info', text: fr.bookshop.absentTitle(title), detail });
  };

  const onIsbn = async (isbn13: string) => {
    const known = rows.find((row) => row.isbn13 === isbn13);
    if (known) {
      setFlash({ kind: 'info', text: fr.bookshop.again(known.title) });
      return;
    }
    latest.current = isbn13;
    const verdict = await loadBookshopCheck(isbn13);
    if (verdict.kind === 'owned') {
      signal('attention');
      const title = verdict.book.title || fr.common.untitled;
      const detail = ownedDetail(verdict, places);
      setRows((current) => [{ isbn13, kind: 'owned', book: verdict.book, title, detail }, ...current]);
      setFlash({ kind: 'warn', text: fr.bookshop.owned(title), detail });
      return;
    }
    signal('read');
    if (verdict.kind === 'wished') {
      const title = verdict.wish.title || isbn13;
      setRows((current) => [{ isbn13, kind: 'wished', book: { title }, title, detail: verdict.wish.author ?? '', wishId: verdict.wish.id }, ...current]);
      setFlash({ kind: 'ok', text: fr.bookshop.wished(title) });
      return;
    }
    // A missing volume of a series of the library, listed by the BnF: known at once, even offline.
    const listed = await loadCatalogMatch(isbn13);
    if (listed) {
      const { group, volume } = listed;
      const detail = group.missing.includes(volume.index)
        ? fr.bookshop.seriesMissing(group.name, volume.index)
        : fr.bookshop.seriesOwned(group.name, group.volumes.length);
      const series = { series: { name: group.name, index: volume.index }, group };
      setRows((current) => [{ isbn13, kind: 'absent', book: { title: volume.title }, title: volume.title, detail, details: series }, ...current]);
      setFlash({ kind: 'info', text: fr.bookshop.absentTitle(volume.title), detail });
    } else {
      setRows((current) => [{ isbn13, kind: 'absent', book: { title: '' }, title: isbn13, detail: fr.bookshop.searching }, ...current]);
      setFlash({ kind: 'info', text: fr.bookshop.absent, detail: fr.bookshop.searching });
    }
    // Searched in the background: the next book may be read meanwhile.
    void complete(isbn13, Boolean(listed)).catch((error: unknown) => {
      console.error(error);
      updateRow(isbn13, { detail: fr.bookshop.unknown });
    });
  };

  const busy = useRef(false);
  const onCode = (code: DetectedCode) => {
    const meaning = classifyCode(code.rawValue, code.format);
    if (meaning.kind === 'ignored' || busy.current) return;
    if (!filter.accept(code.rawValue, Date.now())) return;
    if (meaning.kind === 'shelf') {
      signal('attention');
      setFlash({ kind: 'warn', text: fr.bookshop.shelfQr });
      return;
    }
    busy.current = true;
    void onIsbn(meaning.isbn13)
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        busy.current = false;
      });
  };

  const detectorAvailable = useCodeDetection(camera.status === 'ready', refs, onCode);

  const toggleWish = async (row: Row) => {
    if (row.wishId) {
      await removeWish(row.wishId);
      updateRow(row.isbn13, { wishId: undefined });
      return;
    }
    const { metadata, details } = row;
    const series = details?.group && details.series?.index !== undefined ? { seriesName: details.group.name, seriesIndex: details.series.index } : {};
    const author = metadata?.authors?.[0];
    const { wish } = await addWish({
      // Without metadata, the title listed by the BnF; the ISBN shown instead of a title is not one.
      title: metadata?.title ?? (row.title === row.isbn13 ? '' : row.title),
      isbn: row.isbn13,
      source: 'bookshop',
      ...(author ? { author } : {}),
      ...series,
    });
    updateRow(row.isbn13, { wishId: wish.id });
  };

  const counts = { owned: 0, wished: 0, absent: 0 };
  for (const row of rows) counts[row.kind] += 1;

  return (
    <main class="scan">
      <h1 class="visually-hidden">{fr.bookshop.title}</h1>
      <Viewfinder
        refs={refs}
        camera={camera}
        detectorAvailable={detectorAvailable}
        flash={flash}
        hint={fr.bookshop.hint}
        place={
          <p class="scan__place">
            <ScanIcon size={18} />
            <span class="scan__place-label">{fr.bookshop.title}</span>
          </p>
        }
        actions={
          <a class="scan__round-button" href={routeHref('lists', LIST_TABS.wishes)} aria-label={fr.bookshop.quit}>
            <CloseIcon size={20} />
          </a>
        }
        counters={
          <>
            <span class="scan__counter scan__counter--pending">
              <strong>{formatNumber(counts.owned)}</strong> {fr.bookshop.countOwned(counts.owned)}
            </span>
            <span class="scan__counter">
              <strong>{formatNumber(counts.wished)}</strong> {fr.bookshop.countWished(counts.wished)}
            </span>
            <span class="scan__counter">
              <strong>{formatNumber(counts.absent)}</strong> {fr.bookshop.countAbsent(counts.absent)}
            </span>
          </>
        }
      />

      <section class="scan__sheet" aria-labelledby="bookshop-rows-title">
        <div class="scan__sheet-header">
          <h2 class="scan__sheet-title" id="bookshop-rows-title">
            {fr.bookshop.listTitle}
          </h2>
        </div>
        {rows.length === 0 ? (
          <p class="scan__empty">{fr.bookshop.empty}</p>
        ) : (
          <ul class="scan__rows">
            {rows.map((row) => (
              <li key={row.isbn13} class="scan-row">
                <CoverImage book={row.book} class="cover--row" />
                <span class="scan-row__text">
                  <span class="scan-row__title">{row.title}</span>
                  {row.detail && <span class="scan-row__detail">{row.detail}</span>}
                </span>
                {row.kind === 'absent' ? (
                  <button
                    type="button"
                    class={row.wishId ? 'icon-button wish-toggle wish-toggle--on' : 'icon-button wish-toggle'}
                    aria-pressed={Boolean(row.wishId)}
                    aria-label={row.wishId ? fr.author.unwish(row.title) : fr.author.wish(row.title)}
                    onClick={() => void toggleWish(row)}
                  >
                    <HeartIcon size={20} filled={Boolean(row.wishId)} />
                  </button>
                ) : (
                  <span class={`scan-row__status scan-row__status--${row.kind === 'owned' ? 'warn' : 'ok'}`}>
                    {row.kind === 'owned' ? fr.bookshop.statusOwned : fr.bookshop.statusWished}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div class="scan__actions scan__actions--single">
          <button
            type="button"
            class="button button--primary button--large"
            onClick={() => {
              navigate('lists', LIST_TABS.wishes);
            }}
          >
            {fr.bookshop.finish}
          </button>
        </div>
      </section>
    </main>
  );
}
