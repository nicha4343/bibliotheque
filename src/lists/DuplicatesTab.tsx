import { useState } from 'preact/hooks';
import { CoverImage } from '../components/CoverImage';
import { FileIcon } from '../components/icons';
import { toCsv } from '../csv/csv';
import { downloadText, isoDate } from '../csv/export';
import { db } from '../db/db';
import { useLiveQuery } from '../db/useLiveQuery';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { routeHref } from '../router';
import { fr } from '../textes/fr';
import { duplicateRows, findDuplicates, placesOf, setToGive, type Duplicate } from './duplicates';

interface DuplicatesData {
  duplicates: Duplicate[];
  places: PlaceIndex;
}

async function loadDuplicates(): Promise<DuplicatesData> {
  const [books, copies, places] = await Promise.all([db.books.toArray(), db.copies.toArray(), loadPlaces()]);
  return { duplicates: findDuplicates(books, copies), places };
}

/** « Doublons »: books in several copies, those to give, the list as a CSV file. */
export function DuplicatesTab() {
  const data = useLiveQuery<DuplicatesData | undefined>(() => loadDuplicates(), [], undefined);
  const [message, setMessage] = useState('');
  if (!data) return null;
  const { duplicates, places } = data;

  const exportList = () => {
    const fileName = fr.duplicates.fileName(isoDate(Date.now()));
    downloadText(fileName, toCsv(duplicateRows(duplicates, places)));
    setMessage(fr.duplicates.exported(fileName));
  };

  if (duplicates.length === 0) return <p class="screen__intro">{fr.duplicates.empty}</p>;

  return (
    <>
      <p class="screen__intro">{fr.duplicates.intro}</p>
      <p class="list-head__summary">{fr.duplicates.summary(duplicates.length, duplicates.filter((item) => item.give).length)}</p>
      <ul class="card duplicate-list">
        {duplicates.map(({ book, copies, give }) => {
          const title = book.title || fr.common.untitled;
          return (
            <li key={book.id} class="duplicate-row">
              <a class="duplicate-row__link" href={routeHref('book', book.id)}>
                <CoverImage book={book} class="cover--row" />
                <span class="duplicate-row__text">
                  <span class="duplicate-row__title">
                    {title} <span class="duplicate-row__count">{fr.duplicates.times(copies.length)}</span>
                  </span>
                  <span class="duplicate-row__places">{placesOf(copies, places)}</span>
                </span>
              </a>
              <button
                type="button"
                class={give ? 'small-button give-toggle give-toggle--on' : 'small-button give-toggle'}
                aria-pressed={give}
                aria-label={fr.duplicates.giveLabel(title)}
                onClick={() => void setToGive(book, !give)}
              >
                {fr.duplicates.give}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" class="button button--secondary button--large" onClick={exportList}>
        <FileIcon size={20} />
        {fr.duplicates.export}
      </button>
      <p class="status-line" role="status">
        {message}
      </p>
    </>
  );
}
