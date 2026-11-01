import { useEffect, useRef, useState } from 'preact/hooks';
import {
  addCopy,
  coverCandidates,
  deleteBook,
  moveCopy,
  removeCopy,
  restoreAutoCover,
  setAutoCover,
  setUserCover,
  updateBook,
} from '../books/books';
import { QuotesSection } from '../books/QuotesSection';
import { ReadingSection } from '../books/ReadingSection';
import { TagsSection } from '../books/TagsSection';
import { CameraSheet } from '../components/CameraSheet';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { CoverImage } from '../components/CoverImage';
import { CameraIcon, ChevronLeftIcon, GalleryIcon, PencilIcon, PinIcon, PlusIcon, TrashIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import type { Book, Copy } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { fetchCover, type CoverCandidate } from '../metadata/covers';
import { joinAuthors, parseAuthors } from '../pending/pending';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { navigate, routeHref } from '../router';
import { compressImage } from '../scan/camera';
import { LocationPicker } from '../scan/LocationPicker';
import { fr } from '../textes/fr';

interface BookData {
  book: Book | undefined;
  copies: Copy[];
  places: PlaceIndex;
}

async function loadBook(bookId: string): Promise<BookData> {
  const [book, copies, places] = await Promise.all([
    db.books.get(bookId),
    db.copies.where('bookId').equals(bookId).sortBy('addedAt'),
    loadPlaces(),
  ]);
  return { book, copies, places };
}

type Dialog =
  | { kind: 'cover' }
  | { kind: 'camera' }
  | { kind: 'edit' }
  | { kind: 'addCopy' }
  | { kind: 'move'; copy: Copy }
  | { kind: 'removeCopy'; copy: Copy }
  | { kind: 'delete' };

const coverBadge = (book: Book): string => {
  if (!book.cover) return fr.book.coverNone;
  if (book.cover.source === 'user') return fr.book.coverUser;
  return book.cover.provider ? fr.book.coverAuto(fr.common.providers[book.cover.provider]) : fr.book.coverAutoUnknown;
};

/** Screen 6: information, cover, copies, reading (status, rating, review), tags and quotes. */
export function BookScreen({ bookId }: { bookId: string }) {
  const data = useLiveQuery<BookData | undefined>(() => loadBook(bookId), [bookId], undefined);
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState('');
  const close = () => {
    setDialog(undefined);
  };

  useEffect(() => {
    if (data?.book) document.title = fr.app.documentTitle(data.book.title || fr.common.untitled);
  }, [data?.book]);

  if (!data) return <main class="screen" />;
  const { book, copies, places } = data;
  if (!book) {
    return (
      <main class="screen">
        <div class="screen__inner">
          <a class="text-button book__back" href={routeHref('library')}>
            <ChevronLeftIcon size={20} />
            {fr.book.back}
          </a>
          <p class="screen__intro">{fr.book.notFound}</p>
        </div>
      </main>
    );
  }

  const placeOf = (copy: Copy) => places.byShelfId.get(copy.shelfId)?.label ?? fr.library.noPlace;
  const details = [book.publisher, book.year ? String(book.year) : undefined].filter(Boolean).join(' · ');

  return (
    <main class="screen">
      <div class="screen__inner">
        <div class="book__bar">
          <a class="text-button book__back" href={routeHref('library')}>
            <ChevronLeftIcon size={20} />
            {fr.book.back}
          </a>
          <button
            type="button"
            class="text-button"
            onClick={() => {
              setDialog({ kind: 'edit' });
            }}
          >
            <PencilIcon size={18} />
            {fr.book.edit}
          </button>
        </div>

        <div class="book__head">
          <CoverImage book={book} class="cover--book" />
          <div class="book__info">
            <h1 class="book__title">{book.title || fr.common.untitled}</h1>
            <p class="book__author">{book.authors.join(', ') || fr.common.unknownAuthor}</p>
            {details && <p class="book__details">{details}</p>}
            {book.isbn13 && <p class="book__isbn mono">{book.isbn13}</p>}
            <span class={book.cover ? (book.cover.source === 'user' ? 'tag tag--pending' : 'tag tag--accent') : 'tag'}>
              {coverBadge(book)}
            </span>
          </div>
        </div>

        <button
          type="button"
          class="button button--secondary button--large"
          onClick={() => {
            setDialog({ kind: 'cover' });
          }}
        >
          <CameraIcon size={20} />
          {fr.book.changeCover}
        </button>

        <p class="status-line" role="status">
          {message}
        </p>

        <section class="section" aria-labelledby="copies-title">
          <h2 class="section__title" id="copies-title">
            {fr.book.copies(copies.length)}
          </h2>
          <ul class="card copy-list">
            {copies.map((copy, index) => (
              <li key={copy.id} class="copy">
                <span class="copy__number" aria-hidden="true">
                  {index + 1}
                </span>
                <button
                  type="button"
                  class="copy__place"
                  aria-label={fr.book.move(placeOf(copy))}
                  onClick={() => {
                    setDialog({ kind: 'move', copy });
                  }}
                >
                  <PinIcon size={16} />
                  <span>{placeOf(copy)}</span>
                </button>
                {copies.length > 1 && (
                  <button
                    type="button"
                    class="icon-button copy__remove"
                    aria-label={fr.book.removeCopy(placeOf(copy))}
                    onClick={() => {
                      setDialog({ kind: 'removeCopy', copy });
                    }}
                  >
                    <TrashIcon size={18} />
                  </button>
                )}
              </li>
            ))}
            <li class="copy">
              <button
                type="button"
                class="copy__add"
                onClick={() => {
                  setDialog({ kind: 'addCopy' });
                }}
              >
                <PlusIcon size={18} />
                {fr.book.addCopy}
              </button>
            </li>
          </ul>
        </section>

        <ReadingSection book={book} />
        <TagsSection book={book} />
        <QuotesSection bookId={book.id} onMessage={setMessage} />

        <button
          type="button"
          class="button button--danger button--large book__delete"
          onClick={() => {
            setDialog({ kind: 'delete' });
          }}
        >
          <TrashIcon size={18} />
          {fr.book.delete}
        </button>
      </div>

      {dialog?.kind === 'cover' && (
        <CoverSheet
          book={book}
          onCamera={() => {
            setDialog({ kind: 'camera' });
          }}
          onMessage={setMessage}
          onClose={close}
        />
      )}
      {dialog?.kind === 'camera' && <CameraSheet onCapture={(photo) => setUserCover(book.id, photo)} onClose={close} />}
      {dialog?.kind === 'edit' && <EditSheet book={book} onSaved={setMessage} onClose={close} />}
      {(dialog?.kind === 'addCopy' || dialog?.kind === 'move') && (
        <LocationPicker
          places={places}
          title={dialog.kind === 'addCopy' ? fr.book.addCopyTitle : fr.book.moveTitle}
          currentShelfId={dialog.kind === 'move' ? dialog.copy.shelfId : undefined}
          onPick={(shelf) => {
            const label = places.byShelfId.get(shelf.id)?.label ?? shelf.name;
            close();
            if (dialog.kind === 'addCopy') {
              void addCopy(book.id, shelf.id).then(() => {
                setMessage(fr.book.copyAdded(label));
              });
            } else {
              void moveCopy(dialog.copy.id, shelf.id).then(() => {
                setMessage(fr.book.copyMoved(label));
              });
            }
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === 'removeCopy' && (
        <ConfirmSheet
          title={fr.book.removeCopyTitle}
          text={fr.book.removeCopyText(placeOf(dialog.copy))}
          confirm={fr.book.removeCopyConfirm}
          onConfirm={() => {
            close();
            void removeCopy(dialog.copy.id).then((done) => {
              if (done) setMessage(fr.book.copyRemoved);
            });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmSheet
          title={fr.book.deleteTitle}
          text={fr.book.deleteText}
          confirm={fr.book.deleteConfirm}
          onConfirm={() => {
            close();
            void deleteBook(book.id).then(() => {
              navigate('library');
            });
          }}
          onClose={close}
        />
      )}
    </main>
  );
}

interface CoverSheetProps {
  book: Book;
  onCamera: () => void;
  onMessage: (message: string) => void;
  onClose: () => void;
}

/** « Modifier la couverture »: photograph, gallery, other automatic covers, restore. */
function CoverSheet({ book, onCamera, onMessage, onClose }: CoverSheetProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const candidates = useLiveQuery<CoverCandidate[]>(() => coverCandidates(book), [book.id], []);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const shown = candidates.filter((candidate) => !failed.has(candidate.url) && candidate.url !== book.cover?.url);

  const pickGallery = async (file: File | undefined) => {
    if (!file) return;
    try {
      await setUserCover(book.id, await compressImage(file));
      onClose();
    } catch {
      onMessage(fr.book.imageFailed);
      onClose();
    }
  };

  const pickCandidate = async (candidate: CoverCandidate) => {
    setBusy(true);
    const found = await fetchCover(candidate);
    setBusy(false);
    if (found) await setAutoCover(book.id, found);
    else onMessage(fr.book.coverUnavailable);
    onClose();
  };

  const restore = async () => {
    setBusy(true);
    const restored = await restoreAutoCover(book.id);
    setBusy(false);
    if (!restored) onMessage(fr.book.restoreFailed);
    onClose();
  };

  return (
    <Sheet title={fr.book.coverSheet} onClose={onClose}>
      <div class="option-list">
        <button type="button" class="option-list__item option-list__item--tall" onClick={onCamera}>
          <span class="option-list__icon" aria-hidden="true">
            <CameraIcon size={20} />
          </span>
          <span class="option-list__label">
            {fr.book.takePhoto}
            <span class="option-list__detail">{fr.book.takePhotoDetail}</span>
          </span>
        </button>
        <button type="button" class="option-list__item option-list__item--tall" onClick={() => galleryRef.current?.click()}>
          <span class="option-list__icon" aria-hidden="true">
            <GalleryIcon size={20} />
          </span>
          <span class="option-list__label">
            {fr.book.gallery}
            <span class="option-list__detail">{fr.book.galleryDetail}</span>
          </span>
        </button>
      </div>
      <input
        ref={galleryRef}
        class="visually-hidden"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void pickGallery(event.currentTarget.files?.[0])}
      />

      {book.isbn13 && (
        <>
          <h3 class="sheet__label">{fr.book.otherCovers}</h3>
          {shown.length === 0 ? (
            <p class="sheet__hint">{fr.book.noOtherCovers}</p>
          ) : (
            <div class="cover-choices">
              {shown.map((candidate) => (
                <button
                  key={candidate.url}
                  type="button"
                  class="cover-choice"
                  disabled={busy}
                  aria-label={fr.book.otherCoverLabel(fr.common.providers[candidate.provider])}
                  onClick={() => void pickCandidate(candidate)}
                >
                  <img
                    class="cover cover--card"
                    src={candidate.url}
                    alt=""
                    onError={() => {
                      setFailed((current) => new Set(current).add(candidate.url));
                    }}
                    onLoad={(event) => {
                      // Open Library answers a 1-pixel image when it has no cover.
                      if (event.currentTarget.naturalWidth < 40) setFailed((current) => new Set(current).add(candidate.url));
                    }}
                  />
                  <span class="cover-choice__source">{fr.common.providers[candidate.provider]}</span>
                </button>
              ))}
            </div>
          )}
          {busy && (
            <p class="sheet__hint sheet__hint--busy" role="status">
              <span class="spinner" aria-hidden="true" />
              {fr.book.coverLoading}
            </p>
          )}
          {book.cover?.source === 'user' && (
            <button type="button" class="button button--secondary button--large" disabled={busy} onClick={() => void restore()}>
              {fr.book.restoreCover}
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

/** « Modifier »: title, authors, publisher, year. */
function EditSheet({ book, onSaved, onClose }: { book: Book; onSaved: (message: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState(book.title);
  const [authors, setAuthors] = useState(joinAuthors(book.authors));
  const [publisher, setPublisher] = useState(book.publisher ?? '');
  const [year, setYear] = useState(book.year ? String(book.year) : '');
  const [submitted, setSubmitted] = useState(false);
  const titleMissing = !title.trim();
  const yearInvalid = year.trim() !== '' && !/^\d{4}$/.test(year.trim());

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (titleMissing || yearInvalid) return;
    await updateBook(book.id, {
      title: title.trim(),
      authors: parseAuthors(authors),
      publisher: publisher.trim() || undefined,
      year: year.trim() ? Number(year.trim()) : undefined,
    });
    onSaved(fr.book.saved);
    onClose();
  };

  return (
    <Sheet title={fr.book.editTitle} onClose={onClose}>
      <form class="sheet__form" onSubmit={(event) => void submit(event)} noValidate>
        <div class="field">
          <label class="field__label" for="edit-title">
            {fr.book.titleLabel}
          </label>
          <input
            id="edit-title"
            class="field__input"
            type="text"
            value={title}
            autocomplete="off"
            aria-invalid={submitted && titleMissing}
            onInput={(event) => {
              setTitle(event.currentTarget.value);
            }}
          />
          {submitted && titleMissing && <p class="field__error">{fr.entry.titleRequired}</p>}
        </div>
        <div class="field">
          <label class="field__label" for="edit-authors">
            {fr.book.authorLabel}
          </label>
          <input
            id="edit-authors"
            class="field__input"
            type="text"
            value={authors}
            autocomplete="off"
            aria-describedby="edit-authors-hint"
            onInput={(event) => {
              setAuthors(event.currentTarget.value);
            }}
          />
          <p class="field__hint" id="edit-authors-hint">
            {fr.book.authorHint}
          </p>
        </div>
        <div class="field">
          <label class="field__label" for="edit-publisher">
            {fr.book.publisherLabel}
          </label>
          <input
            id="edit-publisher"
            class="field__input"
            type="text"
            value={publisher}
            autocomplete="off"
            onInput={(event) => {
              setPublisher(event.currentTarget.value);
            }}
          />
        </div>
        <div class="field">
          <label class="field__label" for="edit-year">
            {fr.book.yearLabel}
          </label>
          <input
            id="edit-year"
            class="field__input"
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={year}
            autocomplete="off"
            aria-invalid={submitted && yearInvalid}
            onInput={(event) => {
              setYear(event.currentTarget.value);
            }}
          />
          {submitted && yearInvalid && <p class="field__error">{fr.book.yearInvalid}</p>}
        </div>
        <button type="submit" class="button button--primary button--large">
          {fr.common.save}
        </button>
      </form>
    </Sheet>
  );
}
