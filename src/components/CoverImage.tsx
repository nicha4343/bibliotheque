import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/db';
import type { Book, Id } from '../db/schema';
import { bookPhotoKey } from '../sharing/guest';

/**
 * Object URL of a stored photograph, released when the component goes away; from the pictures of the
 * places shared with the user (lot 13) when shared.
 */
export function useBlobUrl(blobId: Id | undefined, shared = false): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!blobId) return;
    let objectUrl: string | undefined;
    let active = true;
    void (shared ? db.sharedPhotos : db.blobs).get(blobId).then((stored) => {
      if (!active || !stored) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blobId, shared]);
  return url;
}

// Muted colours of the mock-up, for books without a cover.
const PLACEHOLDER_COLOURS = ['#3E5C3A', '#2F4858', '#1F5C7A', '#7A3E2E', '#5B4A7A', '#8A6A1F', '#1F3B57', '#6B4F3A'];

export function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

/** Colour of a book without a cover, also that of its spine on the shelf view. */
export const placeholderColour = (title: string): string =>
  PLACEHOLDER_COLOURS[hash(title) % PLACEHOLDER_COLOURS.length] ?? '#3E5C3A';

/** « La Peste » → « LP » */
export function initialsOf(title: string): string {
  const words = title
    .replace(/^(les?|la|l’|l'|un|une|des|the|a)\s*/i, '')
    .split(/[\s’'-]+/)
    .filter((word) => /\p{L}/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

interface CoverImageProps {
  book: Pick<Book, 'title' | 'cover'> | undefined;
  /** CSS class setting the size. */
  class: string;
  /** Photograph shown instead of the cover (item to complete). */
  photoBlobId?: Id | undefined;
  /** Lot 13: the book belongs to the place shared with the user through this Drive file. */
  sharedFileId?: string | undefined;
}

/** Cover of a book: the photograph or downloaded cover, else its link, else a coloured placeholder. */
export function CoverImage({ book, class: className, photoBlobId, sharedFileId }: CoverImageProps) {
  const blobUrl = useBlobUrl(
    sharedFileId ? book && bookPhotoKey(sharedFileId, book) : (photoBlobId ?? book?.cover?.blobId),
    sharedFileId !== undefined,
  );
  const [failed, setFailed] = useState(false);
  const src = blobUrl ?? (photoBlobId ? undefined : book?.cover?.url);
  const title = book?.title ?? '';

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        class={`cover ${className}`}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => {
          setFailed(true);
        }}
      />
    );
  }
  return (
    <span
      class={`cover cover--placeholder ${className}`}
      style={{ background: placeholderColour(title) }}
      aria-hidden="true"
    >
      {initialsOf(title)}
    </span>
  );
}
