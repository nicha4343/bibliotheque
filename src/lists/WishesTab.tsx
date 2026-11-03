import { useEffect, useState } from 'preact/hooks';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { LinkIcon, PlusIcon, ScanIcon, ShareIcon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { isoDate } from '../csv/export';
import { db } from '../db/db';
import type { Wish } from '../db/schema';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../db/settings';
import { useLiveQuery } from '../db/useLiveQuery';
import { toIsbn13 } from '../isbn/isbn';
import { routeHref } from '../router';
import { fr } from '../textes/fr';
import { encodeWishList, sharedListUrl, toSharedWish } from '../wishes/share';
import { addWish, removeAcquiredWishes, removeWish, sortWishes, updateWish } from '../wishes/wishes';

type Dialog = { kind: 'edit'; wish?: Wish } | { kind: 'share' } | { kind: 'remove'; wish: Wish };

const titleOf = (wish: Wish) => wish.title || (wish.isbn ? fr.wishes.isbn(wish.isbn) : fr.wishes.unknownTitle);

/** « Souhaits »: the bookshop check, the list and its sharing. */
export function WishesTab() {
  const wishes = useLiveQuery<Wish[] | undefined>(async () => sortWishes(await db.wishes.toArray()), [], undefined);
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState('');
  const close = () => {
    setDialog(undefined);
  };

  // Books scanned or imported since: their wishes are fulfilled.
  useEffect(() => {
    void removeAcquiredWishes().then((removed) => {
      if (removed > 0) setMessage(fr.wishes.acquired(removed));
    });
  }, []);

  const count = wishes?.length ?? 0;

  return (
    <>
      <div class="card list-card">
        <div class="list-card__text">
          <h2 class="list-card__title">{fr.wishes.bookshopTitle}</h2>
          <p class="list-card__detail">{fr.wishes.bookshopText}</p>
        </div>
        <a class="button button--primary button--large" href={routeHref('bookshop')}>
          <ScanIcon size={20} />
          {fr.wishes.bookshopAction}
        </a>
      </div>

      <div class="list-head">
        <h2 class="list-head__title">{fr.wishes.title(count)}</h2>
        <button
          type="button"
          class="small-button"
          disabled={count === 0}
          aria-label={fr.wishes.shareLabel}
          onClick={() => {
            setDialog({ kind: 'share' });
          }}
        >
          <LinkIcon size={16} />
          {fr.wishes.share}
        </button>
      </div>

      <p class="status-line" role="status">
        {message}
      </p>

      {wishes && count === 0 && <p class="screen__intro">{fr.wishes.empty}</p>}
      {wishes && count > 0 && (
        <ul class="card wish-list">
          {wishes.map((wish) => (
            <li key={wish.id}>
              <button
                type="button"
                class="wish"
                onClick={() => {
                  setDialog({ kind: 'edit', wish });
                }}
              >
                <span class="wish__cover" aria-hidden="true" />
                <span class="wish__text">
                  <span class="wish__title">{titleOf(wish)}</span>
                  {wish.author && <span class="wish__author">{wish.author}</span>}
                </span>
                <span class="tag wish__source">{fr.wishes.sources[wish.source]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        class="button button--secondary button--large"
        onClick={() => {
          setDialog({ kind: 'edit' });
        }}
      >
        <PlusIcon size={20} />
        {fr.wishes.add}
      </button>

      {dialog?.kind === 'edit' && (
        <WishSheet
          wish={dialog.wish}
          onSaved={(text) => {
            close();
            setMessage(text);
          }}
          onRemove={(wish) => {
            setDialog({ kind: 'remove', wish });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmSheet
          title={fr.wishes.remove}
          text={titleOf(dialog.wish)}
          confirm={fr.wishes.remove}
          onConfirm={() => {
            const { wish } = dialog;
            close();
            void removeWish(wish.id).then(() => {
              setMessage(fr.wishes.removed(titleOf(wish)));
            });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === 'share' && wishes && <ShareSheet wishes={wishes} onClose={close} />}
    </>
  );
}

interface WishSheetProps {
  wish: Wish | undefined;
  onSaved: (message: string) => void;
  onRemove: (wish: Wish) => void;
  onClose: () => void;
}

/** A wish typed by the user, or one to correct. */
function WishSheet({ wish, onSaved, onRemove, onClose }: WishSheetProps) {
  const [title, setTitle] = useState(wish?.title ?? '');
  const [author, setAuthor] = useState(wish?.author ?? '');
  const [isbn, setIsbn] = useState(wish?.isbn ?? '');
  const [submitted, setSubmitted] = useState(false);
  const titleMissing = !title.trim();
  const isbn13 = isbn.trim() ? toIsbn13(isbn) : undefined;
  const isbnInvalid = isbn.trim() !== '' && !isbn13;

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (titleMissing || isbnInvalid) return;
    const fields = { title: title.trim(), author: author.trim(), ...(isbn13 ? { isbn: isbn13 } : {}) };
    if (wish) {
      await updateWish(wish.id, fields);
      onSaved(fr.wishes.saved);
      return;
    }
    const { wish: kept, created } = await addWish({ ...fields, source: 'manual' });
    onSaved(created ? fr.wishes.added(kept.title) : fr.wishes.already(titleOf(kept)));
  };

  return (
    <Sheet title={wish ? fr.wishes.sheetTitle : fr.wishes.newTitle} onClose={onClose}>
      <form class="sheet__form" onSubmit={(event) => void submit(event)} noValidate>
        {wish && <p class="sheet__hint">{fr.wishes.sources[wish.source]}</p>}
        <div class="field">
          <label class="field__label" for="wish-title">
            {fr.wishes.titleLabel}
          </label>
          <input
            id="wish-title"
            class="field__input"
            type="text"
            value={title}
            autocomplete="off"
            aria-invalid={submitted && titleMissing}
            onInput={(event) => {
              setTitle(event.currentTarget.value);
            }}
          />
          {submitted && titleMissing && <p class="field__error">{fr.wishes.titleRequired}</p>}
        </div>
        <div class="field">
          <label class="field__label" for="wish-author">
            {fr.wishes.authorLabel}
          </label>
          <input
            id="wish-author"
            class="field__input"
            type="text"
            value={author}
            autocomplete="off"
            onInput={(event) => {
              setAuthor(event.currentTarget.value);
            }}
          />
        </div>
        <div class="field">
          <label class="field__label" for="wish-isbn">
            {fr.wishes.isbnLabel}
          </label>
          <input
            id="wish-isbn"
            class="field__input mono"
            type="text"
            inputMode="numeric"
            value={isbn}
            autocomplete="off"
            aria-describedby="wish-isbn-hint"
            aria-invalid={submitted && isbnInvalid}
            onInput={(event) => {
              setIsbn(event.currentTarget.value);
            }}
          />
          <p class="field__hint" id="wish-isbn-hint">
            {fr.wishes.isbnHint}
          </p>
          {submitted && isbnInvalid && <p class="field__error">{fr.wishes.isbnInvalid}</p>}
        </div>
        <button type="submit" class="button button--primary button--large">
          {fr.common.save}
        </button>
        {wish && (
          <button
            type="button"
            class="button button--danger button--large"
            onClick={() => {
              onRemove(wish);
            }}
          >
            {fr.wishes.remove}
          </button>
        )}
      </form>
    </Sheet>
  );
}

/** « Partager »: the list travels in the link; relatives see it, not the library. */
function ShareSheet({ wishes, onClose }: { wishes: readonly Wish[]; onClose: () => void }) {
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const [name, setName] = useState<string>();
  const [link, setLink] = useState<string>();
  const [message, setMessage] = useState('');
  const shownName = name ?? settings.wishListName;
  const canShare = typeof navigator.share === 'function';

  // Prepared beforehand: the share sheet of the phone opens only right after a touch.
  useEffect(() => {
    let active = true;
    setLink(undefined);
    void encodeWishList({ name: shownName, date: isoDate(Date.now()), wishes: wishes.map(toSharedWish) }).then((payload) => {
      if (active) setLink(sharedListUrl(window.location.href, routeHref('sharedList', payload)));
    });
    return () => {
      active = false;
    };
  }, [shownName, wishes]);

  const keepName = () => {
    if (name !== undefined && name !== settings.wishListName) void updateSettings({ wishListName: name.trim() });
  };

  const share = () => {
    if (!link) return;
    keepName();
    const title = shownName.trim() ? fr.shareWishes.messageTitle(shownName.trim()) : fr.shareWishes.messageTitleAnonymous;
    navigator.share({ title, text: fr.shareWishes.messageText, url: link }).catch(() => undefined);
  };

  const copy = () => {
    if (!link) return;
    keepName();
    navigator.clipboard.writeText(link).then(
      () => {
        setMessage(fr.shareWishes.copied);
      },
      () => {
        setMessage(fr.shareWishes.copyFailed);
      },
    );
  };

  return (
    <Sheet title={fr.shareWishes.title} onClose={onClose}>
      <p class="sheet__text">{fr.shareWishes.text(wishes.length)}</p>
      <div class="field">
        <label class="field__label" for="share-name">
          {fr.shareWishes.nameLabel}
        </label>
        <input
          id="share-name"
          class="field__input"
          type="text"
          value={shownName}
          autocomplete="given-name"
          aria-describedby="share-name-hint"
          onInput={(event) => {
            setName(event.currentTarget.value);
          }}
        />
        <p class="field__hint" id="share-name-hint">
          {fr.shareWishes.nameHint}
        </p>
      </div>
      <p class="sheet__hint">{fr.shareWishes.note}</p>
      <div class="sheet__actions">
        {canShare && (
          <button type="button" class="button button--primary button--large" disabled={!link} onClick={share}>
            <ShareIcon size={20} />
            {fr.shareWishes.shareLink}
          </button>
        )}
        <button type="button" class={canShare ? 'button button--secondary button--large' : 'button button--primary button--large'} disabled={!link} onClick={copy}>
          <LinkIcon size={20} />
          {fr.shareWishes.copyLink}
        </button>
      </div>
      <p class="status-line" role="status">
        {link ? message : fr.shareWishes.preparing}
      </p>
    </Sheet>
  );
}
