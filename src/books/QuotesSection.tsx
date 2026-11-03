import { useEffect, useRef, useState } from 'preact/hooks';
import { CameraSheet } from '../components/CameraSheet';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useBlobUrl } from '../components/CoverImage';
import { CameraIcon, PencilIcon, TrashIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import type { Id, Quote } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { textRecognitionSupported } from '../ocr/engine';
import { readPassage } from '../ocr/reading';
import { formatDate, fr } from '../textes/fr';
import { addQuote, bookQuotes, deleteQuote, updateQuote } from './quotes';

// A passage must stay legible: larger than a cover photograph.
const PASSAGE_SIZE = 1920;

type Dialog =
  | { kind: 'camera' }
  | { kind: 'new' }
  /** justTaken: the passage was just photographed, its text is read at once (lot 6). */
  | { kind: 'quote'; quoteId: Id; justTaken?: boolean }
  | { kind: 'delete'; quote: Quote };

/** « Citations » (screen 6): photographed passages, whose text the user may type. */
export function QuotesSection({ bookId, onMessage }: { bookId: Id; onMessage: (message: string) => void }) {
  const quotes = useLiveQuery<Quote[]>(() => bookQuotes(bookId), [bookId], []);
  const [dialog, setDialog] = useState<Dialog>();
  const close = () => {
    setDialog(undefined);
  };
  const opened = dialog?.kind === 'quote' ? quotes.find((quote) => quote.id === dialog.quoteId) : undefined;

  return (
    <section class="section" aria-labelledby="quotes-title">
      <h2 class="section__title" id="quotes-title">
        {fr.book.quotes(quotes.length)}
      </h2>
      <ul class="card quote-list">
        {quotes.map((quote) => (
          <li key={quote.id}>
            <button
              type="button"
              class="quote"
              onClick={() => {
                setDialog({ kind: 'quote', quoteId: quote.id });
              }}
            >
              {quote.photoBlobId && <QuotePhoto blobId={quote.photoBlobId} class="quote__thumb" />}
              <span class="quote__body">
                <span class={quote.text ? 'quote__text' : 'quote__text quote__text--none'}>
                  {quote.text ? fr.book.quoteText(quote.text) : fr.book.quoteNoText}
                </span>
                <span class="quote__date">
                  {(quote.photoBlobId ? fr.book.quotePhotographed : fr.book.quoteWritten)(formatDate(new Date(quote.createdAt)))}
                </span>
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            class="card-action"
            onClick={() => {
              setDialog({ kind: 'camera' });
            }}
          >
            <CameraIcon size={20} />
            {fr.book.photographQuote}
          </button>
        </li>
        <li>
          <button
            type="button"
            class="card-action"
            onClick={() => {
              setDialog({ kind: 'new' });
            }}
          >
            <PencilIcon size={20} />
            {fr.book.writeQuote}
          </button>
        </li>
      </ul>

      {dialog?.kind === 'camera' && (
        <CameraSheet
          title={fr.book.photographQuote}
          hint={fr.book.quoteCameraHint}
          maxSize={PASSAGE_SIZE}
          onCapture={async (photo) => {
            const quote = await addQuote(bookId, { photo });
            setDialog({ kind: 'quote', quoteId: quote.id, justTaken: true });
          }}
          // The sheet closes itself after the capture: the quote just opened must stay.
          onClose={() => {
            setDialog((current) => (current?.kind === 'camera' ? undefined : current));
          }}
        />
      )}
      {(dialog?.kind === 'new' || opened) && (
        <QuoteSheet
          key={opened?.id ?? 'new'}
          quote={opened}
          readAtOnce={dialog?.kind === 'quote' && dialog.justTaken === true}
          onSave={async (text) => {
            if (opened) await updateQuote(opened.id, text);
            else await addQuote(bookId, { text });
            onMessage(fr.book.quoteSaved);
            close();
          }}
          onDelete={
            opened
              ? () => {
                  setDialog({ kind: 'delete', quote: opened });
                }
              : undefined
          }
          onClose={close}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmSheet
          title={fr.book.deleteQuoteTitle}
          text={fr.book.deleteQuoteText}
          confirm={fr.book.deleteQuote}
          onConfirm={() => {
            close();
            void deleteQuote(dialog.quote.id).then(() => {
              onMessage(fr.book.quoteDeleted);
            });
          }}
          onClose={close}
        />
      )}
    </section>
  );
}

function QuotePhoto({ blobId, class: className }: { blobId: Id; class: string }) {
  const url = useBlobUrl(blobId);
  return url ? <img class={className} src={url} alt="" /> : <span class={className} />;
}

interface QuoteSheetProps {
  /** Missing for a new quote, typed by hand. */
  quote: Quote | undefined;
  readAtOnce: boolean;
  onSave: (text: string) => Promise<void>;
  onDelete: (() => void) | undefined;
  onClose: () => void;
}

/** The photographed passage, readable at full size, and its text. */
function QuoteSheet({ quote, readAtOnce, onSave, onDelete, onClose }: QuoteSheetProps) {
  const photoUrl = useBlobUrl(quote?.photoBlobId);
  const [zoomed, setZoomed] = useState(false);
  const [text, setText] = useState(quote?.text ?? '');
  const [submitted, setSubmitted] = useState(false);
  // A photographed passage may stay without text; a typed quote may not.
  const textMissing = !quote?.photoBlobId && !text.trim();

  // Lot 6: the text of the passage read on the photograph, to check and shorten.
  const photoBlobId = quote?.photoBlobId;
  const canRead = photoBlobId !== undefined && textRecognitionSupported();
  const [reading, setReading] = useState<'idle' | 'reading' | 'read' | 'nothing' | 'failed'>('idle');
  const typed = useRef(text);
  typed.current = text;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /** Read at once, the text only fills an empty field; asked for, it replaces the field. */
  const read = async (replace: boolean) => {
    if (!photoBlobId) return;
    setReading('reading');
    try {
      const found = await readPassage(photoBlobId);
      if (!mounted.current) return;
      if (found && (replace || !typed.current.trim())) setText(found);
      setReading(found ? 'read' : 'nothing');
    } catch (error) {
      console.error(error);
      if (mounted.current) setReading('failed');
    }
  };

  useEffect(() => {
    if (readAtOnce && canRead) void read(false);
    // Once, when the sheet opens on the passage just photographed.
  }, []);

  const hint =
    reading === 'read'
      ? fr.book.passageRead
      : reading === 'nothing'
        ? fr.book.passageNothing
        : reading === 'failed'
          ? fr.book.passageFailed
          : fr.book.quoteTextHint;

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (textMissing) return;
    await onSave(text);
  };

  return (
    <Sheet title={quote ? fr.book.quoteTitle : fr.book.newQuoteTitle} onClose={onClose}>
      {quote?.photoBlobId && (
        <div class="quote-photo">
          <div class={zoomed ? 'quote-photo__frame quote-photo__frame--zoomed' : 'quote-photo__frame'}>
            {photoUrl && <img class="quote-photo__image" src={photoUrl} alt={fr.book.quotePhoto} />}
          </div>
          <button
            type="button"
            class="text-button quote-photo__zoom"
            aria-pressed={zoomed}
            onClick={() => {
              setZoomed(!zoomed);
            }}
          >
            {zoomed ? fr.book.zoomOut : fr.book.zoomIn}
          </button>
        </div>
      )}
      <form class="sheet__form" onSubmit={(event) => void submit(event)} noValidate>
        <div class="field">
          <label class="field__label" for="quote-text">
            {fr.book.quoteTextLabel}
          </label>
          <textarea
            id="quote-text"
            class="field__input"
            rows={4}
            value={text}
            aria-describedby={quote?.photoBlobId ? 'quote-text-hint' : undefined}
            aria-invalid={submitted && textMissing}
            onInput={(event) => {
              setText(event.currentTarget.value);
            }}
          />
          {quote?.photoBlobId && (
            <p class="field__hint" id="quote-text-hint" role="status">
              {hint}
            </p>
          )}
          {canRead && (
            <button type="button" class="small-button quote-read" disabled={reading === 'reading'} onClick={() => void read(true)}>
              {reading === 'reading' && <span class="spinner" aria-hidden="true" />}
              {reading === 'reading' ? fr.book.readingPassage : fr.book.readPassage}
            </button>
          )}
          {submitted && textMissing && <p class="field__error">{fr.book.quoteTextRequired}</p>}
        </div>
        <div class="sheet__actions">
          <button type="submit" class="button button--primary button--large">
            {fr.common.save}
          </button>
          {onDelete && (
            <button type="button" class="button button--danger button--large" onClick={onDelete}>
              <TrashIcon size={18} />
              {fr.book.deleteQuote}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
