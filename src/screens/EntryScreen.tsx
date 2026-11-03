import { useEffect, useRef, useState } from 'preact/hooks';
import { CameraSheet } from '../components/CameraSheet';
import { CoverImage } from '../components/CoverImage';
import { CameraIcon, CheckIcon, ChevronDownIcon, CloseIcon, PinIcon, ReadTextIcon } from '../components/icons';
import { db } from '../db/db';
import type { Id, PendingItem } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { foldText } from '../library/filter';
import { awaitsReading, currentReading, preferReading } from '../ocr/reading';
import { useReadingFailures } from '../ocr/useReadingFailures';
import { completeItem, joinAuthors, listPendingItems, parseAuthors, readingEntry, setItemPhoto } from '../pending/pending';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { navigate, routeHref } from '../router';
import { LocationPicker } from '../scan/LocationPicker';
import { fr } from '../textes/fr';

interface Draft {
  title: string;
  author: string;
  publisher: string;
}

const EMPTY_DRAFT: Draft = { title: '', author: '', publisher: '' };

/**
 * Screen 4: the items to complete one after the other. With an item id, that item only, then back
 * to screen 3. The list is taken once: items added meanwhile wait for the next series.
 */
export function EntryScreen({ itemId }: { itemId?: string | undefined }) {
  const [queue, setQueue] = useState<Id[]>();
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [shelfId, setShelfId] = useState<Id>();
  const [tookPhoto, setTookPhoto] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showError, setShowError] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentId = queue?.[index];
  // The id comes back with the item: a stale answer for the previous item is never taken for this one.
  const current = useLiveQuery<{ id: Id | undefined; item: PendingItem | undefined } | undefined>(
    async () => ({ id: currentId, item: currentId ? await db.pendingItems.get(currentId) : undefined }),
    [currentId],
    undefined,
  );
  const item = current?.id === currentId ? current?.item : undefined;
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  const remaining = useLiveQuery(() => db.pendingItems.count(), [], 0);
  const single = itemId !== undefined;
  const prefilled = useRef<Id | undefined>(undefined);
  useReadingFailures();

  useEffect(() => {
    document.title = fr.app.documentTitle(fr.entry.title);
    void listPendingItems().then((items) => {
      setQueue(single ? items.filter((i) => i.id === itemId).map((i) => i.id) : items.map((i) => i.id));
    });
  }, [itemId, single]);

  // A fresh form for each item.
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setShelfId(undefined);
    setTookPhoto(false);
    setShowError(false);
  }, [currentId]);

  // The photograph of the item shown is read before the others (lot 6).
  useEffect(() => {
    preferReading(currentId);
    return () => {
      preferReading(undefined);
    };
  }, [currentId]);

  // « Corriger » or « Saisir » (screen 3): the form starts from what was read on the cover.
  useEffect(() => {
    if (!single || !item || prefilled.current === item.id) return;
    const reading = currentReading(item);
    if (!reading) return;
    prefilled.current = item.id;
    const entry = readingEntry(reading);
    setDraft((previous) =>
      previous.title || previous.author || previous.publisher
        ? previous
        : { title: entry.title, author: joinAuthors(entry.authors), publisher: entry.publisher },
    );
  }, [single, item]);

  // An item completed elsewhere meanwhile (found by a new search) is skipped.
  useEffect(() => {
    if (current && current.id === currentId && currentId && !current.item) setIndex((value) => value + 1);
  }, [current, currentId]);

  const finished = queue !== undefined && index >= queue.length;
  useEffect(() => {
    if (finished && single) navigate('pending');
  }, [finished, single]);

  const advance = () => {
    setIndex((value) => value + 1);
    window.scrollTo(0, 0);
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (!item || busy) return;
    if (!draft.title.trim()) {
      setShowError(true);
      return;
    }
    setBusy(true);
    try {
      const authors = parseAuthors(draft.author);
      await completeItem(item.id, { title: draft.title, authors, publisher: draft.publisher }, shelfId ?? item.shelfId);
      setSaved((value) => value + 1);
      advance();
    } finally {
      setBusy(false);
    }
  };

  if (queue === undefined) return <main class="entry" />;

  if (queue.length === 0) {
    return (
      <main class="entry entry--done">
        <p class="entry__done-text">{fr.entry.nothing}</p>
        <a class="button button--primary button--large" href={routeHref('library')}>
          {fr.entry.library}
        </a>
      </main>
    );
  }

  if (finished) {
    if (single) return <main class="entry" />;
    return (
      <main class="entry entry--done">
        <span class="recap__badge">
          <CheckIcon size={28} />
        </span>
        <h1 class="entry__done-title">{remaining === 0 ? fr.entry.doneTitle : fr.entry.endedTitle}</h1>
        <p class="entry__done-text">
          {fr.entry.doneAdded(saved)}
          {remaining > 0 && ` ${fr.entry.doneRemaining(remaining)}`}
        </p>
        <a class="button button--primary button--large" href={routeHref('library')}>
          {fr.entry.library}
        </a>
        {remaining > 0 && (
          <a class="text-button text-button--center" href={routeHref('pending')}>
            {fr.entry.backToPending}
          </a>
        )}
      </main>
    );
  }

  const last = index === queue.length - 1;
  const place = places?.byShelfId.get(shelfId ?? item?.shelfId ?? '')?.label ?? '';
  const caption = tookPhoto
    ? fr.entry.takenHere
    : item?.kind === 'unknownIsbn'
      ? fr.entry.unknownCaption
      : item?.photoBlobId
        ? fr.entry.photoCaption
        : fr.entry.noPhotoCaption;
  // Lot 6: words read on the cover, touched to fill the fields.
  const reading = item ? currentReading(item) : undefined;
  const readingPending = item ? awaitsReading(item) : false;
  const readingStatus = readingPending
    ? fr.entry.readingPending
    : reading
      ? reading.titles.length + reading.authors.length + reading.publishers.length > 0
        ? fr.entry.readingHint
        : fr.entry.readingNothing
      : '';
  const sameText = (a: string, b: string) => foldText(a) === foldText(b);
  const pick = (key: 'title' | 'publisher', value: string) => {
    setDraft((previous) => ({ ...previous, [key]: sameText(previous[key], value) ? '' : value }));
  };
  // Several authors are separated by a comma: an author touched is added, or removed.
  const authorPicked = (name: string) => parseAuthors(draft.author).some((author) => sameText(author, name));
  const toggleAuthor = (name: string) => {
    setDraft((previous) => {
      const authors = parseAuthors(previous.author);
      const next = authors.some((author) => sameText(author, name))
        ? authors.filter((author) => !sameText(author, name))
        : [...authors, name];
      return { ...previous, author: joinAuthors(next) };
    });
  };

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onInput: (event: { currentTarget: HTMLInputElement }) => {
      const value = event.currentTarget.value;
      setDraft((previous) => ({ ...previous, [key]: value }));
    },
  });

  return (
    <main class="entry">
      <header class="entry__header">
        <a class="text-button entry__close" href={routeHref('pending')}>
          <CloseIcon size={20} />
          {fr.entry.close}
        </a>
        <h1 class="entry__step">
          <span class="visually-hidden">{fr.entry.title} · </span>
          {fr.entry.step(index + 1, queue.length)}
        </h1>
        <button type="button" class="text-button" onClick={advance}>
          {fr.entry.postpone}
        </button>
      </header>
      <div class="progress" aria-hidden="true">
        <span class="progress__bar" style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>

      {item && (
        <form class="entry__form" onSubmit={(event) => void save(event)} noValidate>
          <div class="entry__item">
            {item.photoBlobId ? (
              <button
                type="button"
                class="entry__photo"
                aria-label={fr.entry.retakePhoto}
                onClick={() => {
                  setCameraOpen(true);
                }}
              >
                <CoverImage book={undefined} photoBlobId={item.photoBlobId} class="cover--entry" />
              </button>
            ) : (
              <button
                type="button"
                class="entry__shoot"
                onClick={() => {
                  setCameraOpen(true);
                }}
              >
                <CameraIcon size={26} />
                {fr.entry.photographCover}
              </button>
            )}
            <div class="entry__meta">
              <p class="entry__kind">{item.kind === 'unknownIsbn' ? fr.pending.kindUnknown : fr.pending.kindNoBarcode}</p>
              {item.isbn && <p class="entry__isbn mono">{item.isbn}</p>}
              <div class="entry__captions">
                <p class="entry__caption">{caption}</p>
                <p class="entry__caption" role="status">
                  {readingPending && <span class="spinner" aria-hidden="true" />}
                  {readingStatus}
                </p>
              </div>
              <p class="entry__place-label">{fr.entry.place}</p>
              <button
                type="button"
                class="entry__place"
                aria-label={fr.entry.changePlace(place)}
                onClick={() => {
                  setPickerOpen(true);
                }}
              >
                <PinIcon size={16} />
                <span>{place}</span>
                <ChevronDownIcon size={16} />
              </button>
            </div>
          </div>

          <div class="field">
            <label class="field__label" for="entry-title">
              {fr.entry.titleLabel}
            </label>
            <input
              id="entry-title"
              class="field__input"
              type="text"
              placeholder={fr.entry.titlePlaceholder}
              autocomplete="off"
              enterKeyHint="next"
              aria-invalid={showError && !draft.title.trim()}
              aria-describedby={showError ? 'entry-title-error' : undefined}
              {...field('title')}
            />
            {showError && !draft.title.trim() && (
              <p class="field__error" id="entry-title-error">
                {fr.entry.titleRequired}
              </p>
            )}
            <ReadingChips
              label={fr.entry.readingChips(fr.entry.titleLabel)}
              values={reading?.titles ?? []}
              isOn={(value) => sameText(draft.title, value)}
              onPick={(value) => {
                pick('title', value);
              }}
            />
          </div>
          <div class="field">
            <label class="field__label" for="entry-author">
              {fr.entry.authorLabel}
            </label>
            <input
              id="entry-author"
              class="field__input"
              type="text"
              placeholder={fr.entry.authorPlaceholder}
              autocomplete="off"
              enterKeyHint="next"
              {...field('author')}
            />
            <ReadingChips
              label={fr.entry.readingChips(fr.entry.authorLabel)}
              values={reading?.authors ?? []}
              isOn={authorPicked}
              onPick={toggleAuthor}
            />
          </div>
          <div class="field">
            <label class="field__label" for="entry-publisher">
              {fr.entry.publisherLabel}
            </label>
            <input
              id="entry-publisher"
              class="field__input"
              type="text"
              placeholder={fr.entry.publisherPlaceholder}
              autocomplete="off"
              enterKeyHint="done"
              {...field('publisher')}
            />
            <ReadingChips
              label={fr.entry.readingChips(fr.entry.publisherLabel)}
              values={reading?.publishers ?? []}
              isOn={(value) => sameText(draft.publisher, value)}
              onPick={(value) => {
                pick('publisher', value);
              }}
            />
          </div>

          <div class="entry__buttons">
            <button type="button" class="button button--secondary button--large" onClick={advance}>
              {fr.entry.postpone}
            </button>
            <button type="submit" class="button button--primary button--large" disabled={busy}>
              {last ? fr.entry.finish : fr.entry.save}
            </button>
          </div>
        </form>
      )}

      {cameraOpen && item && (
        <CameraSheet
          onCapture={async (photo) => {
            await setItemPhoto(item.id, photo);
            setTookPhoto(true);
          }}
          onClose={() => {
            setCameraOpen(false);
          }}
        />
      )}

      {pickerOpen && places && item && (
        <LocationPicker
          places={places}
          currentShelfId={shelfId ?? item.shelfId}
          onPick={(shelf) => {
            setShelfId(shelf.id);
            setPickerOpen(false);
          }}
          onClose={() => {
            setPickerOpen(false);
          }}
        />
      )}
    </main>
  );
}

interface ReadingChipsProps {
  label: string;
  values: readonly string[];
  isOn: (value: string) => boolean;
  onPick: (value: string) => void;
}

/** Words read on the cover under a field (lot 6): touching one fills the field. */
function ReadingChips({ label, values, isOn, onPick }: ReadingChipsProps) {
  if (values.length === 0) return null;
  return (
    <div class="chips chips--wrap reading-chips" role="group" aria-label={label}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          class="chip reading-chip"
          aria-pressed={isOn(value)}
          onClick={() => {
            onPick(value);
          }}
        >
          <ReadTextIcon size={14} />
          {value}
        </button>
      ))}
    </div>
  );
}
