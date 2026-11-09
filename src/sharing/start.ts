import type { GoogleReturn } from '../backup/google';
import { completeOpening, refreshSharedPlaces } from './guest';
import { uploadSharedPlaces } from './owner';

// Lot 13: the places shared by the user are uploaded when they change, like the backup (shortly after
// the start, every ten minutes, when the network comes back and when the app is left); those shared
// with the user are read again at the same moments and when the app comes back to the foreground.

const FIRST_DELAY = 8_000;
const INTERVAL = 10 * 60_000;
/** A place shared with the user is not read again more often when the app is shown repeatedly. */
const VISIBLE_DELAY = 60_000;

/** Called once at start-up, before the first rendering: completes the opening of a place shared with the user. */
export function startSharing(returned: GoogleReturn | undefined): void {
  if (returned) void completeOpening(returned);
  let readAt = 0;
  const read = () => {
    readAt = Date.now();
    void refreshSharedPlaces();
  };
  const upload = () => {
    void uploadSharedPlaces();
  };
  window.setTimeout(() => {
    upload();
    read();
  }, FIRST_DELAY);
  window.setInterval(() => {
    upload();
    read();
  }, INTERVAL);
  window.addEventListener('online', () => {
    upload();
    read();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') upload();
    else if (Date.now() - readAt > VISIBLE_DELAY) read();
  });
}
