import { useEffect, useRef, useState } from 'preact/hooks';
import { StarIcon } from '../components/icons';
import type { Book, Id, ReadingStatus } from '../db/schema';
import { fr } from '../textes/fr';
import { updateBook } from './books';

/** « Ma lecture » (screen 6): reading status, rating out of 5 and review. */
export function ReadingSection({ book }: { book: Book }) {
  const setStatus = (status: ReadingStatus) => {
    void updateBook(book.id, { status });
  };

  return (
    <section class="section" aria-labelledby="reading-title">
      <h2 class="section__title" id="reading-title">
        {fr.book.reading}
      </h2>
      <div class="card book-card">
        <div class="segmented" role="group" aria-label={fr.book.status}>
          <button
            type="button"
            class="segmented__option"
            aria-pressed={book.status === 'toread'}
            onClick={() => {
              setStatus('toread');
            }}
          >
            {fr.book.toRead}
          </button>
          <button
            type="button"
            class="segmented__option"
            aria-pressed={book.status === 'read'}
            onClick={() => {
              setStatus('read');
            }}
          >
            {fr.book.read}
          </button>
        </div>
        <StarRating
          value={book.rating}
          onChange={(rating) => {
            void updateBook(book.id, { rating });
          }}
        />
        <ReviewField key={book.id} bookId={book.id} initial={book.review} />
      </div>
    </section>
  );
}

/** Five stars; touching the selected one again removes the rating. */
function StarRating({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div class="rating" role="group" aria-label={fr.book.rating}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          class={star <= value ? 'rating__star rating__star--on' : 'rating__star'}
          aria-label={fr.book.ratingStar(star)}
          aria-pressed={star === value}
          onClick={() => {
            onChange(star === value ? 0 : star);
          }}
        >
          <StarIcon size={28} filled={star <= value} />
        </button>
      ))}
      <span class="rating__value">{value ? fr.book.ratingValue(value) : fr.book.notRated}</span>
    </div>
  );
}

const SAVE_DELAY = 800;

/** « Mon avis », saved as the user types (after a short pause) and when the field is left. */
function ReviewField({ bookId, initial }: { bookId: Id; initial: string }) {
  const [text, setText] = useState(initial);
  const latest = useRef(initial);
  const saved = useRef(initial.trim());
  const timer = useRef<number>(undefined);

  const save = () => {
    window.clearTimeout(timer.current);
    const review = latest.current.trim();
    if (review === saved.current) return;
    saved.current = review;
    void updateBook(bookId, { review });
  };

  // Whatever is typed is kept when the sheet is left before the pause.
  useEffect(() => save, []);

  return (
    <div class="field">
      <label class="field__label" for="review">
        {fr.book.reviewLabel}
      </label>
      <textarea
        id="review"
        class="field__input"
        rows={3}
        value={text}
        placeholder={fr.book.reviewPlaceholder}
        onInput={(event) => {
          latest.current = event.currentTarget.value;
          setText(latest.current);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(save, SAVE_DELAY);
        }}
        onBlur={save}
      />
    </div>
  );
}
