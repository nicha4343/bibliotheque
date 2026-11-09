import type { Book, Copy, Cover, Id, Room, SharedPlaceContents, Shelf, Site } from '../db/schema';

// Lot 13: the file of a shared place, in the owner's Google Drive. It holds what the relatives see of
// the place: its rooms, shelves, notices and copies, and the owner's photographs of covers. Left out:
// the readings (each person keeps their own), the prices, the loans, the rest of the library. The
// automatic covers travel as their address: each guest's device downloads them itself.

export const SHARED_FORMAT = 'ma-bibliotheque-lieu';
export const SHARED_VERSION = 1;
/** Compressed JSON. */
export const SHARED_MIME_TYPE = 'application/gzip';

export interface SharedPhotoData {
  id: Id;
  /** JPEG, in base64. */
  data: string;
}

export interface SharedFile extends SharedPlaceContents {
  format: typeof SHARED_FORMAT;
  version: number;
  createdAt: number;
  /** Name of the owner on Google. */
  owner: string;
  photos: SharedPhotoData[];
}

export interface LibraryRecords {
  sites: readonly Site[];
  rooms: readonly Room[];
  shelves: readonly Shelf[];
  books: readonly Book[];
  copies: readonly Copy[];
}

const byId = <T extends { id: string }>(records: T[]): T[] => records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A photograph is carried by the file; an automatic cover with an address is downloaded by the guests. */
export const coverPhotoId = (cover: Cover | undefined): Id | undefined =>
  cover?.blobId && (cover.source === 'user' || !cover.url) ? cover.blobId : undefined;

function sharedCover(cover: Cover | undefined): Cover | undefined {
  if (!cover) return undefined;
  const photo = coverPhotoId(cover);
  if (photo) return { source: cover.source, blobId: photo };
  if (!cover.url) return undefined;
  return cover.provider ? { source: 'auto', url: cover.url, provider: cover.provider } : { source: 'auto', url: cover.url };
}

/** The notice as the guests see it. */
function sharedBook(book: Book): Book {
  const { price: _price, seriesCheckedAt: _checked, cover, ...rest } = book;
  const shared = sharedCover(cover);
  return shared ? { ...rest, cover: shared } : rest;
}

/**
 * What a place shares, in a stable order (its fingerprint tells whether it changed), with the
 * photographs to carry. Undefined when the place no longer exists.
 */
export function placeContents(siteId: Id, records: LibraryRecords): { contents: SharedPlaceContents; photoIds: Id[] } | undefined {
  const site = records.sites.find((candidate) => candidate.id === siteId);
  if (!site) return undefined;
  const rooms = byId(records.rooms.filter((room) => room.siteId === siteId));
  const roomIds = new Set(rooms.map((room) => room.id));
  const shelves = byId(records.shelves.filter((shelf) => roomIds.has(shelf.roomId)).map((shelf) => ({ ...shelf, qrToken: '' })));
  const shelfIds = new Set(shelves.map((shelf) => shelf.id));
  const copies = byId(records.copies.filter((copy) => shelfIds.has(copy.shelfId)));
  const bookIds = new Set(copies.map((copy) => copy.bookId));
  const books = byId(records.books.filter((book) => bookIds.has(book.id)).map(sharedBook));
  const photoIds = [...new Set(books.flatMap((book) => coverPhotoId(book.cover) ?? []))].sort();
  return { contents: { site: { id: site.id, name: site.name, order: site.order }, rooms, shelves, books, copies }, photoIds };
}

/** Fingerprint of what the guests would receive: an unchanged place is not uploaded again. */
export async function contentsHash(owner: string, contents: SharedPlaceContents, photoIds: readonly Id[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ owner, contents, photoIds })));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function transform(blob: Blob, stream: CompressionStream | DecompressionStream): Promise<Blob> {
  return new Response(blob.stream().pipeThrough(stream)).blob();
}

export async function encodeSharedFile(file: SharedFile): Promise<Blob> {
  const compressed = await transform(new Blob([JSON.stringify(file)]), new CompressionStream('gzip'));
  return new Blob([compressed], { type: SHARED_MIME_TYPE });
}

const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** The file read from Drive, checked; undefined when it is not a shared place this version can read. */
export async function decodeSharedFile(blob: Blob): Promise<SharedFile | undefined> {
  try {
    const text = await (await transform(blob, new DecompressionStream('gzip'))).text();
    const value = JSON.parse(text) as Partial<SharedFile> | null;
    if (value?.format !== SHARED_FORMAT || typeof value.version !== 'number' || value.version > SHARED_VERSION) return undefined;
    if (typeof value.createdAt !== 'number' || typeof value.owner !== 'string' || typeof value.site?.id !== 'string') return undefined;
    if (![value.rooms, value.shelves, value.books, value.copies, value.photos].every(isList)) return undefined;
    return value as SharedFile;
  } catch {
    return undefined;
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // By pieces: String.fromCharCode cannot take a whole photograph at once.
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

export function base64ToBlob(data: string, type = 'image/jpeg'): Blob {
  const binary = atob(data);
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type });
}
