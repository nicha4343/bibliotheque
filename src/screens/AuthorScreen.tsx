import { useEffect, useState } from 'preact/hooks';
import { BackLink } from '../components/BackLink';
import { CoverImage } from '../components/CoverImage';
import { ChevronRightIcon, HeartIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { db } from '../db/db';
import type { Book, Wish } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { routeHref } from '../router';
import { missingWorks, searchAuthorWorks, type AuthorWork } from '../series/authorWorks';
import { booksOfAuthor, groupSeries, seriesOf, seriesOfAuthor, type SeriesGroup } from '../series/series';
import { fr } from '../textes/fr';
import { addWish, findWish, removeWish } from '../wishes/wishes';
import { seriesDetail } from './SeriesScreen';

interface AuthorData {
  books: Book[];
  /** Notices of the author. */
  own: Book[];
  series: SeriesGroup[];
  wishes: Wish[];
}

async function loadAuthor(name: string): Promise<AuthorData> {
  const [books, records, wishes] = await Promise.all([db.books.toArray(), db.series.toArray(), db.wishes.toArray()]);
  return { books, own: booksOfAuthor(books, name), series: seriesOfAuthor(groupSeries(books, records), name), wishes };
}

type Search = { status: 'searching' | 'offline' | 'failed' } | { status: 'done'; works: AuthorWork[] };

// Kept while the application is open: coming back to the page asks Open Library nothing more.
const searched = new Map<string, AuthorWork[]>();

/** Open Library's other works of the author; searched again when the network comes back. */
function useAuthorWorks(name: string): [Search, () => void] {
  const [search, setSearch] = useState<Search>(() => {
    const works = searched.get(name);
    return works ? { status: 'done', works } : { status: 'searching' };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (searched.has(name)) return;
    if (!navigator.onLine) {
      setSearch({ status: 'offline' });
      const onOnline = () => {
        setAttempt((value) => value + 1);
      };
      window.addEventListener('online', onOnline, { once: true });
      return () => {
        window.removeEventListener('online', onOnline);
      };
    }
    let active = true;
    setSearch({ status: 'searching' });
    searchAuthorWorks(name).then(
      (works) => {
        searched.set(name, works);
        if (active) setSearch({ status: 'done', works });
      },
      () => {
        if (active) setSearch({ status: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [name, attempt]);

  return [
    search,
    () => {
      setAttempt((value) => value + 1);
    },
  ];
}

/** Screen 9, « Du même auteur »: the author's books, series, and those the library lacks. */
export function AuthorScreen({ name }: { name: string }) {
  const data = useLiveQuery<AuthorData | undefined>(() => loadAuthor(name), [name], undefined);
  const [search, retry] = useAuthorWorks(name);
  const [message, setMessage] = useState('');

  const missing = data && search.status === 'done' ? missingWorks(search.works, data.books) : [];

  const toggle = async (work: AuthorWork, wish: Wish | undefined) => {
    if (wish) {
      await removeWish(wish.id);
      setMessage(fr.wishes.removed(work.title));
    } else {
      await addWish({ title: work.title, author: name, source: 'author', ...(work.isbn13 ? { isbn: work.isbn13 } : {}) });
      setMessage(fr.wishes.added(work.title));
    }
  };

  return (
    <Screen title={name} kicker={fr.author.kicker} subtitle={data && fr.author.summary(data.own.length)}>
      <BackLink href={routeHref('library')} label={fr.series.back} />

      {data && data.series.length > 0 && (
        <section class="section" aria-labelledby="author-series-title">
          <h2 class="section__title" id="author-series-title">
            {fr.author.series}
          </h2>
          <div class="card">
            {data.series.map((group) => (
              <a key={group.key} class="link-row link-row--detail" href={routeHref('series', group.name)}>
                <span class="setting__text">
                  <span class="setting__label">{group.name}</span>
                  <span class="setting__detail">{seriesDetail(group)}</span>
                </span>
                <ChevronRightIcon size={18} />
              </a>
            ))}
          </div>
        </section>
      )}

      {data && data.own.length > 0 && (
        <section class="section" aria-labelledby="author-owned-title">
          <h2 class="section__title" id="author-owned-title">
            {fr.author.owned}
          </h2>
          <ul class="book-list">
            {data.own.map((book) => {
              const series = seriesOf(book);
              const detail = series
                ? series.index === undefined
                  ? fr.book.series(series.name)
                  : fr.book.seriesVolume(series.name, series.index)
                : [book.publisher, book.year ? String(book.year) : undefined].filter(Boolean).join(' · ');
              return (
                <li key={book.id}>
                  <a class="book-row" href={routeHref('book', book.id)}>
                    <CoverImage book={book} class="cover--list" />
                    <span class="book-row__text">
                      <span class="book-row__title">{book.title || fr.common.untitled}</span>
                      {detail && <span class="book-row__author">{detail}</span>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section class="section" aria-labelledby="author-missing-title">
        <h2 class="section__title" id="author-missing-title">
          {fr.author.missing}
        </h2>
        {search.status === 'searching' && (
          <p class="sheet__hint sheet__hint--busy" role="status">
            <span class="spinner" aria-hidden="true" />
            {fr.author.searching}
          </p>
        )}
        {search.status === 'offline' && <p class="screen__intro">{fr.author.offline}</p>}
        {search.status === 'failed' && (
          <div class="status-line status-line--warn status-line--with-action" role="status">
            <span>{fr.author.failed}</span>
            <button type="button" class="small-button" onClick={retry}>
              {fr.author.retry}
            </button>
          </div>
        )}
        {search.status === 'done' && missing.length === 0 && <p class="screen__intro">{fr.author.noneMissing}</p>}
        {data && missing.length > 0 && (
          <>
            <ul class="card work-list">
              {missing.map((work) => {
                const wish = findWish(data.wishes, { title: work.title, author: name, isbn: work.isbn13 });
                return (
                  <li key={work.key} class="work">
                    <span class="work__text">
                      <span class="work__title">{work.title}</span>
                      {work.year !== undefined && <span class="work__detail">{fr.author.year(work.year)}</span>}
                    </span>
                    <button
                      type="button"
                      class={wish ? 'icon-button wish-toggle wish-toggle--on' : 'icon-button wish-toggle'}
                      aria-pressed={Boolean(wish)}
                      aria-label={wish ? fr.author.unwish(work.title) : fr.author.wish(work.title)}
                      onClick={() => void toggle(work, wish)}
                    >
                      <HeartIcon size={20} filled={Boolean(wish)} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p class="screen__intro">{fr.author.source}</p>
          </>
        )}
      </section>

      <p class="status-line" role="status">
        {message}
      </p>
    </Screen>
  );
}
