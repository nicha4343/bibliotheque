import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { CoverImage } from '../components/CoverImage';
import { CloseIcon, PinIcon, QuestionIcon, UndoIcon } from '../components/icons';
import { db } from '../db/db';
import type { CheckRead, ShelfCheck } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { navigate, routeHref } from '../router';
import type { DetectedCode } from '../scan/detector';
import { beep, vibrate, type Signal } from '../scan/feedback';
import { classifyCode, RepeatFilter } from '../scan/reads';
import { useCamera, useCodeDetection } from '../scan/useCamera';
import { Viewfinder, type Flash } from '../scan/Viewfinder';
import {
  addCheckRead,
  cancelCheck,
  checkProgress,
  endCheck,
  judgeReads,
  loadCheckLibrary,
  openCheck,
  removeCheckRead,
  type CheckLibrary,
  type ReadVerdict,
} from '../shelves/check';
import { formatNumber, fr } from '../textes/fr';

interface CheckData {
  check: ShelfCheck | undefined;
  library?: CheckLibrary;
  verdicts?: ReadVerdict[];
}

async function loadCheck(checkId: string): Promise<CheckData> {
  const check = await db.shelfChecks.get(checkId);
  if (!check) return { check };
  const library = await loadCheckLibrary(check.shelfId, check.reads.map((read) => read.isbn13));
  return { check, library, verdicts: judgeReads(check.reads, library) };
}

const titleOf = (verdict: ReadVerdict) => verdict.book?.title || fr.common.untitled;

function flashOf(verdict: ReadVerdict, places: PlaceIndex | undefined): Flash {
  switch (verdict.kind) {
    case 'inPlace':
      return { kind: 'ok', text: fr.check.inPlace(titleOf(verdict)) };
    case 'misplaced':
      return { kind: 'warn', text: fr.check.misplaced(titleOf(verdict), places?.byShelfId.get(verdict.copy.shelfId)?.label ?? '') };
    case 'notOwned':
      return { kind: 'warn', text: fr.check.notOwned };
    case 'repeated':
      return { kind: 'info', text: fr.check.repeated(verdict.book ? titleOf(verdict) : fr.check.rowNotOwned) };
  }
}

/** « Vérifier cette étagère »: the shelf is scanned again; the comparison is shown on the shelf view. */
export function ShelfCheckScreen({ shelfId }: { shelfId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => ({ video: videoRef, view: viewRef, aim: aimRef }), []);
  const camera = useCamera(videoRef);

  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  const place = places?.byShelfId.get(shelfId);
  const [checkId, setCheckId] = useState<string>();
  const data = useLiveQuery<CheckData | undefined>(
    () => (checkId ? loadCheck(checkId) : Promise.resolve(undefined)),
    [checkId],
    undefined,
  );
  const check = data?.check;
  const reads = check?.reads ?? [];
  const verdicts = data?.verdicts ?? [];
  const progress = data?.library ? checkProgress(verdicts, data.library) : undefined;

  const [flash, setFlash] = useState<Flash>({ kind: 'info', text: fr.check.ready });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const filter = useRef(new RepeatFilter()).current;

  const signal = (kind: Signal) => {
    if (settings.scanSound) beep(kind);
    if (settings.scanVibration) vibrate(kind);
  };

  useEffect(() => {
    document.title = fr.app.documentTitle(fr.check.title);
  }, []);

  // Resume the check left open on this shelf, or start one, once the shelf is known to exist.
  const shelfExists = Boolean(place);
  useEffect(() => {
    if (shelfExists) void openCheck(shelfId).then((opened) => {
      setCheckId(opened.id);
    });
  }, [shelfId, shelfExists]);

  // The meaning of a read is known once it is stored: signalled then, so that a misplaced book is
  // noticed without looking at the screen.
  const known = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!data?.verdicts || !check) return;
    const previous = known.current;
    known.current = check.reads.length;
    const last = data.verdicts.at(-1);
    if (previous === undefined || check.reads.length <= previous || !last) return;
    signal(last.kind === 'inPlace' ? 'read' : 'attention');
    setFlash(flashOf(last, places));
  }, [data]);

  const onCode = (code: DetectedCode) => {
    const meaning = classifyCode(code.rawValue, code.format);
    if (meaning.kind === 'ignored') return;
    if (!filter.accept(code.rawValue, Date.now())) return;
    if (!check || check.endedAt !== undefined) return;
    if (meaning.kind === 'shelf') {
      void db.shelves
        .where('qrToken')
        .equals(meaning.token)
        .first()
        .then((shelf) => {
          const label = shelf && places?.byShelfId.get(shelf.id)?.label;
          if (!shelf || !label) {
            signal('attention');
            setFlash({ kind: 'warn', text: fr.scan.unknownShelfQr });
          } else if (shelf.id === shelfId) {
            signal('read');
            setFlash({ kind: 'info', text: fr.check.thisShelf(label) });
          } else {
            signal('attention');
            setFlash({ kind: 'warn', text: fr.check.otherShelf(label) });
          }
        });
      return;
    }
    void addCheckRead(check.id, meaning.isbn13);
  };

  const detectorAvailable = useCodeDetection(camera.status === 'ready', refs, onCode);

  if (places && !place) {
    return (
      <main class="screen">
        <div class="screen__inner">
          <a class="text-button back-bar__link" href={routeHref('shelves')}>
            {fr.shelf.back}
          </a>
          <p class="screen__intro">{fr.shelf.notFound}</p>
        </div>
      </main>
    );
  }

  const finish = async () => {
    if (check) await endCheck(check.id);
    navigate('shelf', shelfId);
  };

  const cancel = async () => {
    if (check) await cancelCheck(check.id);
    navigate('shelf', shelfId);
  };

  // Newest first, each with its index among the reads.
  const rows = reads.map((read, index) => ({ read, index, verdict: verdicts[index] })).reverse();

  return (
    <main class="scan">
      <h1 class="visually-hidden">{fr.check.title}</h1>
      <Viewfinder
        refs={refs}
        camera={camera}
        detectorAvailable={detectorAvailable}
        flash={flash}
        hint={settings.rememberShelfOrder ? fr.check.hintOrdered : fr.check.hintFree}
        place={
          <p class="scan__place">
            <PinIcon size={18} />
            <span class="scan__place-label">{place?.label}</span>
          </p>
        }
        actions={
          <a class="scan__round-button" href={routeHref('shelf', shelfId)} aria-label={fr.check.quit}>
            <CloseIcon size={20} />
          </a>
        }
        counters={
          progress && (
            <>
              <span class="scan__counter">
                <strong>{formatNumber(progress.found)}</strong> {fr.check.found(progress.found, progress.expected)}
              </span>
              {progress.toReview > 0 && (
                <span class="scan__counter scan__counter--pending">
                  <strong>{formatNumber(progress.toReview)}</strong> {fr.check.toReview}
                </span>
              )}
            </>
          )
        }
      />

      <section class="scan__sheet" aria-labelledby="check-reads-title">
        <div class="scan__sheet-header">
          <h2 class="scan__sheet-title" id="check-reads-title">
            {fr.check.listTitle}
          </h2>
          <button
            type="button"
            class="text-button"
            disabled={reads.length === 0}
            onClick={() => {
              if (check) void removeCheckRead(check.id);
            }}
          >
            <UndoIcon size={18} />
            {fr.scan.undo}
          </button>
        </div>
        {rows.length === 0 ? (
          <p class="scan__empty">{fr.check.empty}</p>
        ) : (
          <ul class="scan__rows">
            {rows.map(({ read, index, verdict }) => (
              <CheckRow
                key={`${index}-${read.at}`}
                read={read}
                verdict={verdict}
                places={places}
                onRemove={() => {
                  if (check) void removeCheckRead(check.id, index);
                }}
              />
            ))}
          </ul>
        )}
        <div class="scan__actions">
          <button
            type="button"
            class="button button--secondary button--large"
            disabled={!check}
            onClick={() => {
              if (reads.length > 0) setConfirmCancel(true);
              else void cancel();
            }}
          >
            {fr.check.cancel}
          </button>
          <button type="button" class="button button--primary button--large" disabled={!check} onClick={() => void finish()}>
            {fr.check.finish(reads.length)}
          </button>
        </div>
      </section>

      {confirmCancel && (
        <ConfirmSheet
          title={fr.check.cancelTitle}
          text={fr.check.cancelText(reads.length)}
          confirm={fr.check.cancelConfirm}
          icon={<CloseIcon size={18} />}
          onConfirm={() => {
            setConfirmCancel(false);
            void cancel();
          }}
          onClose={() => {
            setConfirmCancel(false);
          }}
        />
      )}
    </main>
  );
}

interface CheckRowProps {
  read: CheckRead;
  verdict: ReadVerdict | undefined;
  places: PlaceIndex | undefined;
  onRemove: () => void;
}

function CheckRow({ read, verdict, places, onRemove }: CheckRowProps) {
  const book = verdict?.book;
  const isbn = <span class="mono">{read.isbn13}</span>;
  let visual = <CoverImage book={book} class="cover--row" />;
  let title: string = book?.title || fr.common.untitled;
  let detail = <>{book?.authors.join(', ') || fr.common.unknownAuthor}</>;
  let status: string = fr.check.rowInPlace;
  let tone = 'ok';

  switch (verdict?.kind) {
    case undefined:
      visual = (
        <span class="cover cover--row cover--searching" aria-hidden="true">
          <span class="spinner" />
        </span>
      );
      title = fr.scan.rowSearching;
      detail = isbn;
      status = '';
      break;
    case 'inPlace':
      break;
    case 'misplaced':
      detail = <>{fr.check.rowMisplacedDetail(places?.byShelfId.get(verdict.copy.shelfId)?.label ?? fr.library.noPlace)}</>;
      status = fr.check.rowMisplaced;
      tone = 'warn';
      break;
    case 'notOwned':
      if (!book) {
        visual = (
          <span class="cover cover--row cover--pending" aria-hidden="true">
            <QuestionIcon size={18} />
          </span>
        );
        title = fr.shelf.notOwnedTitle;
      }
      detail = isbn;
      status = fr.check.rowNotOwned;
      tone = 'warn';
      break;
    case 'repeated':
      if (!book) title = fr.shelf.notOwnedTitle;
      status = fr.check.rowRepeated;
      tone = 'muted';
      break;
  }

  return (
    <li class={`scan-row${verdict?.kind === 'repeated' ? ' scan-row--dimmed' : ''}`}>
      {visual}
      <span class="scan-row__text">
        <span class="scan-row__title">{title}</span>
        <span class="scan-row__detail">{detail}</span>
      </span>
      <span class={`scan-row__status scan-row__status--${tone}`}>{status}</span>
      <button
        type="button"
        class="icon-button scan-row__remove"
        aria-label={fr.check.removeRow(book?.title || read.isbn13)}
        onClick={onRemove}
      >
        <CloseIcon size={18} />
      </button>
    </li>
  );
}
