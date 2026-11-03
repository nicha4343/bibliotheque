import { isValidIsbn13 } from '../isbn/isbn';

/** What a code read by the camera means for the app. */
export type CodeMeaning = { kind: 'isbn'; isbn13: string } | { kind: 'shelf'; token: string } | { kind: 'ignored' };

// A shelf label holds a link to the app ending in #/etagere/<token>; only the token matters,
// so labels keep working if the app moves to another address.
const SHELF_QR = /#\/etagere\/([A-Za-z0-9_-]{8,64})$/;

export function shelfQrContent(appUrl: string, token: string): string {
  return `${appUrl.replace(/#.*$/, '')}#/etagere/${token}`;
}

export function classifyCode(rawValue: string, format: string): CodeMeaning {
  const value = rawValue.trim();
  if (format === 'qr_code') {
    const match = SHELF_QR.exec(value);
    return match?.[1] ? { kind: 'shelf', token: match[1] } : { kind: 'ignored' };
  }
  // Price codes and 5-digit add-ons are not ISBNs.
  if (format === 'ean_13' && isValidIsbn13(value)) return { kind: 'isbn', isbn13: value };
  return { kind: 'ignored' };
}

/**
 * Ignores a code seen again less than windowMs after its previous sighting. A book left in front
 * of the camera is therefore read only once; it is read again after being out of sight.
 */
export class RepeatFilter {
  private readonly lastSeen = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs = 2500) {
    this.windowMs = windowMs;
  }

  accept(code: string, now: number): boolean {
    const previous = this.lastSeen.get(code);
    this.lastSeen.set(code, now);
    for (const [other, seen] of this.lastSeen) if (now - seen > this.windowMs) this.lastSeen.delete(other);
    return previous === undefined || now - previous >= this.windowMs;
  }

  /** Forgets every code, e.g. after an answer to the « Ouvrage déjà possédé » dialog. */
  reset(): void {
    this.lastSeen.clear();
  }
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * Whether a code detected in the video frame lies in the aiming frame drawn on screen. The video
 * fills its view with object-fit: cover; neighbouring books' codes outside the frame are ignored.
 */
export function isInAimArea(box: Rect, video: Size, view: Size, aim: Rect, margin = 0.15): boolean {
  if (video.width === 0 || video.height === 0) return false;
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const offsetX = (view.width - video.width * scale) / 2;
  const offsetY = (view.height - video.height * scale) / 2;
  const centerX = (box.x + box.width / 2) * scale + offsetX;
  const centerY = (box.y + box.height / 2) * scale + offsetY;
  const marginX = aim.width * margin;
  const marginY = aim.height * margin;
  return (
    centerX >= aim.x - marginX &&
    centerX <= aim.x + aim.width + marginX &&
    centerY >= aim.y - marginY &&
    centerY <= aim.y + aim.height + marginY
  );
}

/**
 * The part of the video frame shown inside the aiming frame drawn on screen (object-fit: cover), in
 * video pixels, enlarged by margin on each side and kept within the frame: the photograph of a cover
 * keeps only the cover, not the neighbouring books.
 */
export function aimAreaInVideo(video: Size, view: Size, aim: Rect, margin = 0.04): Rect {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const offsetX = (view.width - video.width * scale) / 2;
  const offsetY = (view.height - video.height * scale) / 2;
  const left = Math.max(0, (aim.x - aim.width * margin - offsetX) / scale);
  const top = Math.max(0, (aim.y - aim.height * margin - offsetY) / scale);
  const right = Math.min(video.width, (aim.x + aim.width * (1 + margin) - offsetX) / scale);
  const bottom = Math.min(video.height, (aim.y + aim.height * (1 + margin) - offsetY) / scale);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}
