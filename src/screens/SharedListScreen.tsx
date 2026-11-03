import { useEffect, useState } from 'preact/hooks';
import { HeartIcon } from '../components/icons';
import { routeHref } from '../router';
import { formatDate, fr } from '../textes/fr';
import { decodeWishList, type SharedList } from '../wishes/share';

/** « 2026-11-03 » → 3 November 2026, local time. */
function dayOf(text: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

/**
 * A wish list opened from the link a user shared (screen 11): read from the link only, nothing is
 * stored, and nothing of the library of this device is shown.
 */
export function SharedListScreen({ payload }: { payload: string }) {
  const [list, setList] = useState<SharedList | null>();

  useEffect(() => {
    let active = true;
    void decodeWishList(payload).then((decoded) => {
      if (active) setList(decoded ?? null);
    });
    return () => {
      active = false;
    };
  }, [payload]);

  const title = list?.name ? fr.sharedList.title(list.name) : fr.sharedList.titleAnonymous;
  useEffect(() => {
    document.title = title;
  }, [title]);

  const date = list ? dayOf(list.date) : undefined;

  return (
    <main class="screen shared-list">
      <div class="screen__inner">
        <header class="screen__header">
          <p class="screen__kicker">
            <HeartIcon size={16} filled />
            {fr.app.name}
          </p>
          <h1 class="screen__title">{title}</h1>
          {list && date && <p class="screen__subtitle">{fr.sharedList.summary(formatDate(date), list.wishes.length)}</p>}
        </header>

        {list === undefined && <p class="screen__intro">{fr.sharedList.loading}</p>}
        {list === null && <p class="status-line status-line--warn">{fr.sharedList.invalid}</p>}
        {list?.wishes.length === 0 && <p class="screen__intro">{fr.sharedList.empty}</p>}
        {list && list.wishes.length > 0 && (
          <ul class="card wish-list">
            {list.wishes.map((wish, index) => (
              <li key={`${index}-${wish.title}`} class="wish wish--static">
                <span class="wish__cover" aria-hidden="true" />
                <span class="wish__text">
                  <span class="wish__title">{wish.title || fr.wishes.unknownTitle}</span>
                  {wish.author && <span class="wish__author">{wish.author}</span>}
                  {wish.isbn && <span class="wish__isbn mono">{fr.sharedList.isbn(wish.isbn)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p class="screen__intro">{fr.sharedList.note}</p>
        <a class="button button--secondary button--large" href={routeHref('library')}>
          {fr.sharedList.open}
        </a>
      </div>
    </main>
  );
}
