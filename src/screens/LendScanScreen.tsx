import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { CloseIcon, LoanIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Book, Copy, Loan } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { LendSheet } from '../loans/LendSheet';
import { cancelLoan, loadLendScan, returnLoan, undoReturn, type LoanDuration } from '../loans/loans';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { navigate, routeHref } from '../router';
import type { DetectedCode } from '../scan/detector';
import { beep, vibrate, type Signal } from '../scan/feedback';
import { classifyCode, RepeatFilter } from '../scan/reads';
import { useCamera, useCodeDetection } from '../scan/useCamera';
import { Viewfinder, type Flash } from '../scan/Viewfinder';
import { formatNearDate, formatNumber, fr } from '../textes/fr';

/** One book lent or given back during this visit, newest first; the cross undoes it. */
interface Row {
  kind: 'lent' | 'givenBack';
  loan: Loan;
  book: Book;
  /** Where the book is kept. */
  place: string;
}

type Dialog = { kind: 'lend'; book: Book; copies: Copy[] } | { kind: 'choose'; book: Book; loans: Loan[]; copies: Copy[] };

const titleOf = (book: Book) => book.title || fr.common.untitled;

/** « Prêter un ouvrage », or « Restituer un ouvrage »: given back only, a book at home is not lent. */
export type LendScanMode = 'lend' | 'return';

/**
 * Screen 10: a book read is lent through the lending sheet; a lent book read is given back (when lending
 * too). Nothing is asked when the meaning is plain, as in the scan of screen 1.
 */
export function LendScanScreen({ mode }: { mode: LendScanMode }) {
  const lending = mode === 'lend';
  const readyFlash: Flash = { kind: 'info', text: lending ? fr.lendScan.ready : fr.lendScan.readyReturn };
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => ({ video: videoRef, view: viewRef, aim: aimRef }), []);
  const camera = useCamera(videoRef);

  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [dialog, setDialog] = useState<Dialog>();
  const [flash, setFlash] = useState<Flash>(readyFlash);
  const [last, setLast] = useState<{ borrower: string; duration: LoanDuration }>();
  const filter = useRef(new RepeatFilter()).current;
  // A book left without an answer is not offered again while it stays in front of the camera.
  const dismissed = useRef<string | undefined>(undefined);
  const busy = useRef(false);

  const signal = (kind: Signal) => {
    if (settings.scanSound) beep(kind);
    if (settings.scanVibration) vibrate(kind);
  };

  useEffect(() => {
    document.title = fr.app.documentTitle(lending ? fr.lendScan.title : fr.lendScan.titleReturn);
  }, [lending]);

  const placeOf = (shelfId: string | undefined) => (shelfId && places?.byShelfId.get(shelfId)?.label) || fr.library.noPlace;

  const giveBack = async (book: Book, loan: Loan, copies: Copy[]) => {
    const done = await returnLoan(loan.id);
    if (!done) return;
    const place = placeOf(copies.find((copy) => copy.id === loan.copyId)?.shelfId);
    setRows((current) => [{ kind: 'givenBack', loan: done, book, place }, ...current]);
    setFlash({ kind: 'ok', text: fr.lendScan.givenBackFlash(titleOf(book)), detail: fr.lendScan.rowGivenBack(place) });
  };

  const onIsbn = async (isbn13: string) => {
    // A book handled during this visit is still in front of the camera: reading it again changes nothing.
    const handled = rows.find((row) => row.book.isbn13 === isbn13);
    if (handled) {
      setFlash({
        kind: 'info',
        text:
          handled.kind === 'lent'
            ? fr.lendScan.justLent(titleOf(handled.book), handled.loan.borrower)
            : fr.lendScan.justGivenBack(titleOf(handled.book)),
      });
      return;
    }
    const scan = await loadLendScan(isbn13);
    switch (scan.kind) {
      case 'notOwned':
        signal('attention');
        setFlash({ kind: 'warn', text: fr.lendScan.notOwned });
        break;
      case 'lend':
        if (!lending) {
          signal('attention');
          setFlash({ kind: 'warn', text: fr.lendScan.notLent(titleOf(scan.book)) });
          break;
        }
        signal('read');
        setDialog({ kind: 'lend', book: scan.book, copies: scan.copies });
        break;
      case 'return': {
        signal('read');
        const copies = await loadCopies(scan.book);
        await giveBack(scan.book, scan.loan, copies);
        break;
      }
      case 'choose': {
        const [onlyLoan] = scan.loans;
        // Given back only: a copy at home does not make the read ambiguous.
        if (!lending && onlyLoan && scan.loans.length === 1) {
          signal('read');
          await giveBack(scan.book, onlyLoan, await loadCopies(scan.book));
          break;
        }
        signal('attention');
        setDialog({ kind: 'choose', book: scan.book, loans: scan.loans, copies: lending ? scan.copies : [] });
        break;
      }
    }
  };

  const onCode = (code: DetectedCode) => {
    const meaning = classifyCode(code.rawValue, code.format);
    if (meaning.kind === 'ignored' || dialog || busy.current) return;
    if (!filter.accept(code.rawValue, Date.now())) return;
    if (meaning.kind === 'shelf') {
      dismissed.current = undefined;
      signal('attention');
      setFlash({ kind: 'warn', text: fr.lendScan.shelfQr });
      return;
    }
    if (meaning.isbn13 === dismissed.current) return;
    dismissed.current = undefined;
    busy.current = true;
    void onIsbn(meaning.isbn13).finally(() => {
      busy.current = false;
    });
  };

  const detectorAvailable = useCodeDetection(camera.status === 'ready' && !dialog, refs, onCode);

  const dismiss = () => {
    if (dialog?.book.isbn13) dismissed.current = dialog.book.isbn13;
    setDialog(undefined);
    setFlash(readyFlash);
  };

  const onLent = (book: Book, loan: Loan, copy: Copy, duration: LoanDuration) => {
    setDialog(undefined);
    setRows((current) => [{ kind: 'lent', loan, book, place: placeOf(copy.shelfId) }, ...current]);
    setLast({ borrower: loan.borrower, duration });
    setFlash({
      kind: 'ok',
      text: fr.lendScan.lentFlash(titleOf(book), loan.borrower),
      detail: fr.loans.reminderOn(formatNearDate(new Date(loan.dueAt), new Date())),
    });
  };

  const undo = async (row: Row) => {
    if (row.kind === 'lent') {
      await cancelLoan(row.loan.id);
    } else if (!(await undoReturn(row.loan.id))) {
      setFlash({ kind: 'warn', text: fr.lendScan.undoFailed });
      return;
    }
    setRows((current) => current.filter((item) => item !== row));
    setFlash({
      kind: 'info',
      text: row.kind === 'lent' ? fr.lendScan.undoneLend(titleOf(row.book)) : fr.lendScan.undoneGiveBack(titleOf(row.book)),
    });
  };

  const lent = rows.filter((row) => row.kind === 'lent').length;
  const givenBack = rows.length - lent;

  return (
    <main class="scan">
      <h1 class="visually-hidden">{lending ? fr.lendScan.title : fr.lendScan.titleReturn}</h1>
      <Viewfinder
        refs={refs}
        camera={camera}
        detectorAvailable={detectorAvailable}
        flash={flash}
        hint={lending ? fr.lendScan.hint : fr.lendScan.hintReturn}
        place={
          <p class="scan__place">
            <LoanIcon size={18} />
            <span class="scan__place-label">{lending ? fr.lendScan.title : fr.lendScan.titleReturn}</span>
          </p>
        }
        actions={
          <a class="scan__round-button" href={routeHref('loans')} aria-label={fr.lendScan.quit}>
            <CloseIcon size={20} />
          </a>
        }
        counters={
          <>
            {lending && (
              <span class="scan__counter">
                <strong>{formatNumber(lent)}</strong> {fr.lendScan.lent(lent)}
              </span>
            )}
            <span class="scan__counter">
              <strong>{formatNumber(givenBack)}</strong> {fr.lendScan.givenBack(givenBack)}
            </span>
          </>
        }
      />

      <section class="scan__sheet" aria-labelledby="lend-rows-title">
        <div class="scan__sheet-header">
          <h2 class="scan__sheet-title" id="lend-rows-title">
            {fr.lendScan.listTitle}
          </h2>
        </div>
        {rows.length === 0 ? (
          <p class="scan__empty">{lending ? fr.lendScan.empty : fr.lendScan.emptyReturn}</p>
        ) : (
          <ul class="scan__rows">
            {rows.map((row) => (
              <li key={`${row.kind}-${row.loan.id}`} class="scan-row">
                <CoverImage book={row.book} class="cover--row" />
                <span class="scan-row__text">
                  <span class="scan-row__title">{titleOf(row.book)}</span>
                  <span class="scan-row__detail">
                    {row.kind === 'lent'
                      ? fr.lendScan.rowLent(row.loan.borrower, formatNearDate(new Date(row.loan.dueAt), new Date()))
                      : fr.lendScan.rowGivenBack(row.place)}
                  </span>
                </span>
                <span class={`scan-row__status scan-row__status--${row.kind === 'lent' ? 'ok' : 'muted'}`}>
                  {row.kind === 'lent' ? fr.lendScan.statusLent : fr.lendScan.statusGivenBack}
                </span>
                <button
                  type="button"
                  class="icon-button scan-row__remove"
                  aria-label={fr.lendScan.undoRow(titleOf(row.book))}
                  onClick={() => void undo(row)}
                >
                  <CloseIcon size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="scan__actions scan__actions--single">
          <button
            type="button"
            class="button button--primary button--large"
            onClick={() => {
              navigate('loans');
            }}
          >
            {fr.lendScan.finish}
          </button>
        </div>
      </section>

      {dialog?.kind === 'lend' && places && (
        <LendSheet
          key={dialog.book.id}
          book={dialog.book}
          copies={dialog.copies}
          places={places}
          scanned
          initialBorrower={last?.borrower}
          initialDuration={last?.duration}
          onLent={(loan, copy, duration) => {
            onLent(dialog.book, loan, copy, duration);
          }}
          onClose={dismiss}
        />
      )}

      {dialog?.kind === 'choose' && (
        <Sheet title={titleOf(dialog.book)} showTitle={false} onClose={dismiss}>
          <div class="lend__book">
            <CoverImage book={dialog.book} class="cover--list" />
            <div class="lend__text">
              <p class="lend__title">{titleOf(dialog.book)}</p>
              <p class="lend__detail">{dialog.book.authors.join(', ')}</p>
            </div>
          </div>
          <p class="sheet__text">{fr.lendScan.chooseText(dialog.loans.length)}</p>
          <div class="sheet__actions">
            {dialog.loans.map((loan) => (
              <button
                key={loan.id}
                type="button"
                class="button button--primary button--tall"
                onClick={() => {
                  const { book } = dialog;
                  setDialog(undefined);
                  void loadCopies(book).then((copies) => giveBack(book, loan, copies));
                }}
              >
                <span class="button__main">{fr.lendScan.givenBackBy(loan.borrower)}</span>
                <span class="button__detail">{fr.lendScan.lentSince(formatNearDate(new Date(loan.lentAt), new Date()))}</span>
              </button>
            ))}
            {dialog.copies.length > 0 && (
              <button
                type="button"
                class="button button--secondary button--large"
                onClick={() => {
                  setDialog({ kind: 'lend', book: dialog.book, copies: dialog.copies });
                }}
              >
                {fr.lendScan.lendAnother}
              </button>
            )}
            <button type="button" class="button button--secondary button--large" onClick={dismiss}>
              {fr.lendScan.ignore}
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

const loadCopies = (book: Book): Promise<Copy[]> => db.copies.where('bookId').equals(book.id).toArray();
