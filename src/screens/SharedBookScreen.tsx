import { useEffect } from 'preact/hooks';
import { ReadingSection } from '../books/ReadingSection';
import { NO_READING, type ReadingFields } from '../books/readings';
import { BackAnchor } from '../components/BackLink';
import { CoverImage } from '../components/CoverImage';
import { PinIcon } from '../components/icons';
import { db } from '../db/db';
import type { SharedPlace } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { routeHref } from '../router';
import { seriesOf } from '../series/series';
import { sharedPlaceIndex } from '../sharing/sharedLibrary';
import { formatDate, fr } from '../textes/fr';

interface SharedBookData {
  place: SharedPlace | undefined;
  reading: ReadingFields;
}

/**
 * A book of a place shared with the user (lot 13): the owner's notice and the places of its copies,
 * which cannot be changed, and « Ma lecture », which belongs to the user.
 */
export function SharedBookScreen({ fileId, bookId }: { fileId: string; bookId: string }) {
  const data = useLiveQuery<SharedBookData | undefined>(
    async () => ({ place: await db.sharedPlaces.get(fileId), reading: (await db.readings.get(bookId)) ?? NO_READING }),
    [fileId, bookId],
    undefined,
  );
  const contents = data?.place?.contents;
  const book = contents?.books.find((candidate) => candidate.id === bookId);

  useEffect(() => {
    if (book) document.title = fr.app.documentTitle(book.title || fr.common.untitled);
  }, [book]);

  if (!data) return <main class="screen" />;
  const back = <BackAnchor class="text-button book__back" href={routeHref('sharedPlace', fileId)} label={data.place?.name ?? fr.sharing.placeBack} />;
  if (!contents || !book) {
    return (
      <main class="screen">
        <div class="screen__inner">
          {back}
          <p class="screen__intro">{fr.sharing.bookNotFound}</p>
        </div>
      </main>
    );
  }

  const places = sharedPlaceIndex(contents);
  const copies = contents.copies.filter((copy) => copy.bookId === book.id).sort((a, b) => a.addedAt - b.addedAt);
  const details = [book.publisher, book.year ? String(book.year) : undefined].filter(Boolean).join(' · ');
  const series = seriesOf(book);

  return (
    <main class="screen">
      <div class="screen__inner">
        <div class="book__bar">{back}</div>

        <div class="book__head">
          <CoverImage book={book} class="cover--book" sharedFileId={fileId} />
          <div class="book__info">
            <p class="screen__kicker">{fr.sharing.bookKicker(contents.site.name)}</p>
            <h1 class="book__title">{book.title || fr.common.untitled}</h1>
            <p class="book__author">{book.authors.join(', ') || fr.common.unknownAuthor}</p>
            {series && (
              <p class="book__details">
                {series.index === undefined ? fr.book.series(series.name) : fr.book.seriesVolume(series.name, series.index)}
              </p>
            )}
            {details && <p class="book__details">{details}</p>}
            {book.isbn13 && <p class="book__isbn mono">{book.isbn13}</p>}
          </div>
        </div>

        <p class="field__hint">{fr.sharing.readOnly}</p>

        <section class="section" aria-labelledby="copies-title">
          <h2 class="section__title" id="copies-title">
            {copies.length > 1 ? fr.book.copies(copies.length) : fr.sharing.where}
          </h2>
          <ul class="card copy-list">
            {copies.map((copy, index) => (
              <li key={copy.id} class="copy">
                <span class="copy__number" aria-hidden="true">
                  {index + 1}
                </span>
                <span class="copy__text">
                  <span class="copy__place">
                    <PinIcon size={16} />
                    <span>{places.byShelfId.get(copy.shelfId)?.roomLabel ?? fr.library.noPlace}</span>
                  </span>
                  {copy.lostAt !== undefined && (
                    <span class="copy__detail copy__detail--lost">{fr.book.lostOn(formatDate(new Date(copy.lostAt)))}</span>
                  )}
                  {copy.note && <span class="copy__detail">{copy.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <ReadingSection bookId={book.id} reading={data.reading} />

        {book.tags.length > 0 && (
          <section class="section" aria-labelledby="shared-tags-title">
            <h2 class="section__title" id="shared-tags-title">
              {fr.sharing.tags}
            </h2>
            <div class="card book-card">
              <ul class="chips chips--wrap tag-list" aria-label={fr.book.tagsOfBook}>
                {book.tags.map((tag) => (
                  <li key={tag} class="tag">
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
