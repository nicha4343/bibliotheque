import type { MetadataProvider, Timestamp } from '../db/schema';
import { googleBooksPause } from '../metadata/search';

// An ISBN unknown to the sources that answered, while another did not answer, is searched again by
// itself (lot 15): a refusal of Google Books says nothing of the book, and Google Books is often the
// only source to know the recent books of small publishers.

const MINUTE_MS = 60_000;
/** After the first, second, third… automatic search; then every six hours. */
const DELAYS_MS = [5 * MINUTE_MS, 30 * MINUTE_MS, 120 * MINUTE_MS, 360 * MINUTE_MS];

/** When to search again an item whose last search (the retries-th automatic one) found sources silent. */
export function nextSearchAt(retries: number, silent: readonly MetadataProvider[], now = Date.now()): Timestamp {
  const delay = DELAYS_MS[Math.min(retries, DELAYS_MS.length - 1)] ?? 0;
  const pause = silent.includes('googleBooks') ? googleBooksPause(now) : undefined;
  // A minute after Google Books starts again, so that its quota is surely renewed.
  return Math.max(now + delay, pause ? pause.until + MINUTE_MS : 0);
}
