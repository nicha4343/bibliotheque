import type { Copy, Id } from '../db/schema';

// « Mémoriser l’ordre sur l’étagère »: Copy.position is a sort key, from left to right. A scan gives
// the time of the read (later reads come further right); a shelf check renumbers the shelf in the
// order of its reads. Only the order of the keys matters, never their values.

type Placed = Pick<Copy, 'position' | 'addedAt'>;

/** Copies of a shelf from left to right: known positions first, then the others by date added. */
export function sortByPosition<T extends Placed>(copies: readonly T[]): T[] {
  return [...copies].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.addedAt - b.addedAt);
}

/**
 * Positions after a check. The copies read take the order of reading (readPositions); a copy that was
 * not read (missing, lent, without barcode) keeps its place right after the copy it followed. A copy
 * whose position was unknown and that was not read stays without one.
 */
export function positionsAfterCheck(shelfCopies: readonly Copy[], readPositions: ReadonlyMap<Id, number>): Map<Id, number> {
  const positions = new Map(readPositions);
  // Runs of copies not read, each placed after the last copy read before it.
  let previous = 0;
  let run: Copy[] = [];
  const placeRun = () => {
    run.forEach((copy, index) => positions.set(copy.id, previous + (index + 1) / (run.length + 1)));
    run = [];
  };
  for (const copy of sortByPosition(shelfCopies)) {
    const read = readPositions.get(copy.id);
    if (read !== undefined) {
      placeRun();
      previous = read;
    } else if (copy.position !== undefined) {
      run.push(copy);
    }
  }
  placeRun();
  return positions;
}

/** Numbers shown on the shelf (1, 2, 3…) for the copies whose position is known. */
export function rankOf(copies: readonly Copy[]): Map<Id, number> {
  const ranks = new Map<Id, number>();
  for (const copy of sortByPosition(copies)) if (copy.position !== undefined) ranks.set(copy.id, ranks.size + 1);
  return ranks;
}
