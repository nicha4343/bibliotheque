import type { Wish } from '../db/schema';
import { wishSeriesLabel } from './wishes';

// « Partager » the wish list (screen 11) without a server: the list travels in the link itself, after
// the « # », which browsers never send to the host. Relatives see the list, not the library. The link
// holds the list of the day: it must be shared again after a change.

export interface SharedWish {
  title: string;
  author?: string;
  isbn?: string;
  /** « Pat’Apouf, tome 14 ». */
  series?: string;
}

export interface SharedList {
  /** Name of the user, at the top of the list (may be empty). */
  name: string;
  /** Day the list was shared, 2026-11-03. */
  date: string;
  wishes: SharedWish[];
}

const VERSION = 1;

/** Each wish: its title, then its author, ISBN and series when known (empty strings keep the places). */
type Packed = { v: number; n?: string; d: string; w: string[][] };

export const toSharedWish = (wish: Wish): SharedWish => {
  const shared: SharedWish = { title: wish.title };
  if (wish.author) shared.author = wish.author;
  if (wish.isbn) shared.isbn = wish.isbn;
  const series = wishSeriesLabel(wish);
  if (series) shared.series = series;
  return shared;
};

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Compressed JSON, written with the characters allowed in a link (base64url); also the invitations of lot 13. */
export async function packForLink(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  return toBase64Url(await transform(json, new CompressionStream('deflate-raw')));
}

/** The value packed in a link; throws when the link is cut short or altered. */
export async function unpackFromLink(payload: string): Promise<unknown> {
  const json = await transform(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(json)) as unknown;
}

/** Compressed list, written with the characters allowed in a link (base64url). */
export async function encodeWishList(list: SharedList): Promise<string> {
  const packed: Packed = {
    v: VERSION,
    d: list.date,
    w: list.wishes.map((wish) => {
      const row = [wish.title, wish.author ?? '', wish.isbn ?? '', wish.series ?? ''];
      while (row.length > 1 && row.at(-1) === '') row.pop();
      return row;
    }),
  };
  if (list.name.trim()) packed.n = list.name.trim();
  return packForLink(packed);
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** Undefined when the link is cut short or altered. */
export async function decodeWishList(payload: string): Promise<SharedList | undefined> {
  try {
    const packed = (await unpackFromLink(payload)) as Partial<Packed> | null;
    if (packed?.v !== VERSION || !isText(packed.d) || !Array.isArray(packed.w)) return undefined;
    const wishes: SharedWish[] = [];
    for (const row of packed.w as unknown[]) {
      if (!Array.isArray(row) || !row.every(isText)) return undefined;
      const [title = '', author, isbn, series] = row;
      const wish: SharedWish = { title };
      if (author) wish.author = author;
      if (isbn && /^\d{13}$/.test(isbn)) wish.isbn = isbn;
      if (series) wish.series = series;
      wishes.push(wish);
    }
    return { name: isText(packed.n) ? packed.n : '', date: packed.d, wishes };
  } catch {
    return undefined;
  }
}

/** Address of the application followed by the route of a shared list. */
export function sharedListUrl(appUrl: string, hash: string): string {
  return `${appUrl.split('#')[0] ?? appUrl}${hash}`;
}
