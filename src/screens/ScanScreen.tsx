import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { CameraIcon, ChevronDownIcon, CloseIcon, PinIcon, QuestionIcon, UndoIcon } from '../components/icons';
import { db } from '../db/db';
import type { Book, ScanEntry, ScanSession, Shelf } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { navigate } from '../router';
import { captureFrame } from '../scan/camera';
import type { DetectedCode } from '../scan/detector';
import { DuplicateDialog } from '../scan/DuplicateDialog';
import { beep, vibrate, type Signal } from '../scan/feedback';
import { LocationPicker } from '../scan/LocationPicker';
import { wakeLookups } from '../scan/lookups';
import { classifyCode, RepeatFilter } from '../scan/reads';
import {
  answerDuplicate,
  deleteEntry,
  endSession,
  getActiveSession,
  lastShelfId,
  recordIsbn,
  recordNoBarcode,
  setSessionShelf,
  startSession,
  undoLastEntry,
} from '../scan/session';
import { useCamera, useCodeDetection } from '../scan/useCamera';
import { Viewfinder, type Flash } from '../scan/Viewfinder';
import { formatNumber, fr } from '../textes/fr';

interface Row {
  entry: ScanEntry;
  book: Book | undefined;
}

async function loadRows(sessionId: string): Promise<Row[]> {
  const entries = (await db.scanEntries.where('sessionId').equals(sessionId).sortBy('createdAt')).reverse();
  const ids = [...new Set(entries.map((entry) => entry.bookId).filter((id): id is string => Boolean(id)))];
  const books = new Map((await db.books.bulkGet(ids)).filter(Boolean).map((book) => [book?.id, book]));
  return entries.map((entry) => ({ entry, book: entry.bookId ? books.get(entry.bookId) : undefined }));
}

const titleOf = (book: Book | undefined) => book?.title || fr.common.untitled;

/** Screen 1: burst scanning. The camera stays open; slow work happens in the background. */
export function ScanScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => ({ video: videoRef, view: viewRef, aim: aimRef }), []);
  const camera = useCamera(videoRef);

  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  // null while loading, undefined when no session is open.
  const session = useLiveQuery<ScanSession | undefined | null>(() => getActiveSession(), [], null);
  const sessionId = session?.id;
  const rows = useLiveQuery(() => (sessionId ? loadRows(sessionId) : Promise.resolve([])), [sessionId], []);
  const pendingCount = useLiveQuery(() => db.pendingItems.count(), [], 0);
  // Rows are newest first: the oldest unanswered question comes last.
  const question = rows.filter((row) => row.entry.status === 'asking').at(-1)?.entry;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>({ kind: 'info', text: fr.scan.ready });
  const [busy, setBusy] = useState(false);
  const filter = useRef(new RepeatFilter()).current;
  const starting = useRef(false);

  const place = session ? places?.byShelfId.get(session.shelfId) : undefined;

  const signal = (kind: Signal) => {
    if (settings.scanSound) beep(kind);
    if (settings.scanVibration) vibrate(kind);
  };

  useEffect(() => {
    document.title = fr.app.documentTitle(fr.scan.title);
  }, []);

  // Resume the open session, or start one at the last shelf used; otherwise ask where to scan.
  useEffect(() => {
    if (session !== undefined || starting.current) return;
    starting.current = true;
    void lastShelfId()
      .then(async (shelfId) => {
        if (shelfId) await startSession(shelfId);
        else setPickerOpen(true);
      })
      .finally(() => {
        starting.current = false;
      });
  }, [session]);

  // Announce the results of the background searches.
  const previous = useRef(new Map<string, ScanEntry['status']>());
  useEffect(() => {
    const known = previous.current;
    for (const { entry, book } of [...rows].reverse()) {
      const before = known.get(entry.id);
      if (before === 'searching' && entry.status !== 'searching') {
        if (entry.status === 'added') setFlash({ kind: 'ok', text: fr.scan.added(titleOf(book)) });
        else if (entry.status === 'pending') setFlash({ kind: 'warn', text: fr.scan.unknown });
        else if (entry.status === 'asking') setFlash({ kind: 'warn', text: fr.scan.alreadyOwned(titleOf(book)) });
      }
      known.set(entry.id, entry.status);
    }
  }, [rows]);

  const changeShelf = async (shelf: Shelf, text: string) => {
    if (session) await setSessionShelf(session.id, shelf.id);
    else await startSession(shelf.id);
    setFlash({ kind: 'ok', text });
  };

  const onCode = (code: DetectedCode) => {
    const meaning = classifyCode(code.rawValue, code.format);
    if (meaning.kind === 'ignored') return;
    // Always noted, so that a book left in view during a dialog is not read again afterwards.
    if (!filter.accept(code.rawValue, Date.now())) return;
    // Reads are suspended while « Ouvrage déjà possédé » awaits an answer.
    if (question) return;
    if (meaning.kind === 'shelf') {
      void db.shelves
        .where('qrToken')
        .equals(meaning.token)
        .first()
        .then(async (shelf) => {
          const target = shelf && places?.byShelfId.get(shelf.id);
          if (!shelf || !target) {
            signal('attention');
            setFlash({ kind: 'warn', text: fr.scan.unknownShelfQr });
            return;
          }
          if (shelf.id === session?.shelfId) return;
          signal('read');
          setPickerOpen(false);
          await changeShelf(shelf, fr.scan.shelfQr(target.label));
        });
      return;
    }
    if (!session || pickerOpen) {
      if (!session) setFlash({ kind: 'warn', text: fr.scan.choosePlaceFirst });
      return;
    }
    if (!navigator.onLine && !settings.offlineScanning) {
      signal('attention');
      setFlash({ kind: 'warn', text: fr.scan.offlineRefused });
      return;
    }
    signal('read');
    const options = { flagOwnedBooks: settings.flagOwnedBooks, position: settings.rememberShelfOrder ? Date.now() : undefined };
    void recordIsbn(session, meaning.isbn13, options).then((entry) => {
      if (entry.status === 'searching') {
        setFlash({ kind: 'info', text: navigator.onLine ? fr.scan.read(meaning.isbn13) : fr.scan.offline });
        wakeLookups();
      } else if (entry.status === 'asking') {
        void db.books.get(entry.bookId ?? '').then((book) => {
          setFlash({ kind: 'warn', text: fr.scan.alreadyOwned(titleOf(book)) });
        });
      } else if (entry.status === 'extraCopy') {
        setFlash({ kind: 'ok', text: fr.scan.extraCopyAdded(fr.common.ordinal(entry.copyNumber ?? 2), place?.label ?? '') });
      }
    });
  };

  const detecting = camera.status === 'ready';
  const detectorAvailable = useCodeDetection(detecting, refs, onCode);

  const answer = async (addCopy: boolean) => {
    if (!question) return;
    const row = rows.find((r) => r.entry.id === question.id);
    const copyNumber = await answerDuplicate(question.id, addCopy);
    if (copyNumber) {
      const here = places?.byShelfId.get(question.shelfId)?.label ?? '';
      setFlash({ kind: 'ok', text: fr.scan.extraCopyAdded(fr.common.ordinal(copyNumber), here) });
    } else {
      setFlash({ kind: 'info', text: fr.scan.notAdded(titleOf(row?.book)) });
    }
  };

  const undo = async () => {
    if (!session) return;
    if (await undoLastEntry(session.id)) setFlash({ kind: 'info', text: fr.scan.undone });
  };

  const remove = async (entry: ScanEntry) => {
    await deleteEntry(entry);
    setFlash({ kind: 'info', text: fr.scan.removed });
  };

  const photograph = async () => {
    const video = videoRef.current;
    if (!session || !video || busy) return;
    setBusy(true);
    try {
      const photo = await captureFrame(video);
      await recordNoBarcode(session, photo, { position: settings.rememberShelfOrder ? Date.now() : undefined });
      signal('read');
      setFlash({ kind: 'warn', text: fr.scan.photographed });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!session) {
      navigate('library');
      return;
    }
    const ended = await endSession(session.id);
    if (ended && ended.counts.scanned > 0) navigate('recap', ended.id);
    else navigate('library');
  };

  return (
    <main class="scan">
      <h1 class="visually-hidden">{fr.scan.title}</h1>
      <Viewfinder
        refs={refs}
        camera={camera}
        detectorAvailable={detectorAvailable}
        flash={flash}
        hint={settings.rememberShelfOrder ? fr.scan.hintOrdered : fr.scan.hint}
        place={
          <button
            type="button"
            class="scan__place"
            onClick={() => {
              setPickerOpen(true);
            }}
          >
            <PinIcon size={18} />
            <span class="scan__place-label">{place?.label ?? fr.scan.choosePlace}</span>
            <ChevronDownIcon size={16} />
          </button>
        }
        counters={
          <>
            <span class="scan__counter">
              <strong>{formatNumber(rows.length)}</strong> {fr.scan.scanned(rows.length)}
            </span>
            <span class="scan__counter scan__counter--pending">
              <strong>{formatNumber(pendingCount)}</strong> {fr.scan.pending}
            </span>
          </>
        }
      />

      <section class="scan__sheet" aria-labelledby="session-title">
        <div class="scan__sheet-header">
          <h2 class="scan__sheet-title" id="session-title">
            {fr.scan.sessionTitle}
          </h2>
          <button type="button" class="text-button" onClick={() => void undo()} disabled={rows.length === 0}>
            <UndoIcon size={18} />
            {fr.scan.undo}
          </button>
        </div>
        {rows.length === 0 ? (
          <p class="scan__empty">{fr.scan.emptySession}</p>
        ) : (
          <ul class="scan__rows">
            {rows.map((row) => (
              <SessionRow key={row.entry.id} row={row} onRemove={() => void remove(row.entry)} />
            ))}
          </ul>
        )}
        <div class="scan__actions">
          <button
            type="button"
            class="button button--secondary button--large"
            disabled={!session || camera.status !== 'ready' || busy}
            onClick={() => void photograph()}
          >
            <CameraIcon size={20} />
            {fr.scan.noBarcode}
          </button>
          <button type="button" class="button button--primary button--large" onClick={() => void finish()}>
            {fr.scan.finish(rows.length)}
          </button>
        </div>
      </section>

      {places && pickerOpen && (
        <LocationPicker
          places={places}
          currentShelfId={session?.shelfId}
          onPick={(shelf) => {
            setPickerOpen(false);
            void changeShelf(shelf, fr.scan.placeChanged(places.byShelfId.get(shelf.id)?.label ?? shelf.name));
          }}
          onClose={
            session
              ? () => {
                  setPickerOpen(false);
                }
              : undefined
          }
        />
      )}

      {places && question && !pickerOpen && (
        <DuplicateDialog key={question.id} entry={question} places={places} onAnswer={(add) => void answer(add)} />
      )}
    </main>
  );
}

function SessionRow({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const { entry, book } = row;
  const isbn = <span class="mono">{entry.isbn13}</span>;
  let visual = <CoverImage book={book} class="cover--row" />;
  let title: string = titleOf(book);
  let detail: ComponentChildren = book?.authors.join(', ') || fr.common.unknownAuthor;
  let status: string = fr.scan.rowAdded;
  let tone = 'ok';
  let dimmed = false;

  switch (entry.status) {
    case 'searching':
      visual = (
        <span class="cover cover--row cover--searching" aria-hidden="true">
          <span class="spinner" />
        </span>
      );
      title = fr.scan.rowSearching;
      detail = isbn;
      status = fr.scan.rowInProgress;
      tone = 'muted';
      break;
    case 'asking':
      detail = fr.scan.rowAlreadyHere;
      status = fr.scan.rowWaiting;
      tone = 'warn';
      break;
    case 'extraCopy':
      detail = fr.scan.rowCopy(fr.common.ordinal(entry.copyNumber ?? 2));
      break;
    case 'notAdded':
      detail = fr.scan.rowAlreadyInLibrary;
      status = fr.scan.rowNotAdded;
      tone = 'muted';
      dimmed = true;
      break;
    case 'pending':
      visual = (
        <span class="cover cover--row cover--pending" aria-hidden="true">
          {entry.kind === 'noBarcode' ? <CameraIcon size={18} /> : <QuestionIcon size={18} />}
        </span>
      );
      title = entry.kind === 'noBarcode' ? fr.scan.rowNoBarcode : fr.scan.rowUnknown;
      detail = entry.kind === 'noBarcode' ? fr.scan.rowPhotographed : isbn;
      status = fr.scan.rowToComplete;
      tone = 'warn';
      break;
    case 'added':
      break;
  }

  return (
    <li class={`scan-row${dimmed ? ' scan-row--dimmed' : ''}`}>
      {visual}
      <span class="scan-row__text">
        <span class="scan-row__title">{title}</span>
        <span class="scan-row__detail">{detail}</span>
      </span>
      <span class={`scan-row__status scan-row__status--${tone}`}>{status}</span>
      <button
        type="button"
        class="icon-button scan-row__remove"
        aria-label={fr.scan.removeRow(entry.status === 'searching' || !book ? (entry.isbn13 ?? title) : title)}
        onClick={onRemove}
      >
        <CloseIcon size={18} />
      </button>
    </li>
  );
}
