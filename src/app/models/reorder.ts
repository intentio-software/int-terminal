/**
 * Where a dragged tab lands.
 *
 * Pulled out of the component because it is the part with the off-by-one in
 * it, and a component that needs a real pointer and a real strip to exercise
 * is a component nobody tests.
 */

/** Move one item, returning a new array. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return [...items];
  }
  const next = [...items];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving);
  return next;
}

/** A tab's box, as the strip sees it. */
export interface Extent {
  left: number;
  width: number;
  top: number;
  height: number;
}

/**
 * The rows a strip has wrapped its tabs onto.
 *
 * Tabs arrive in strip order, which with wrapping is reading order, so a row
 * ends the moment a tab's top moves down. Compared with half a tab's height
 * rather than exactly, because sub-pixel layout means two tabs on the same
 * row rarely report the same top to the decimal.
 */
function rowsOf(extents: readonly Extent[]): number[][] {
  const rows: number[][] = [];
  let current: number[] = [];
  let top = Number.NaN;
  extents.forEach((extent, index) => {
    if (current.length && Math.abs(extent.top - top) > extent.height / 2) {
      rows.push(current);
      current = [];
    }
    if (!current.length) {
      top = extent.top;
    }
    current.push(index);
  });
  if (current.length) {
    rows.push(current);
  }
  return rows;
}

/**
 * The index a cursor at `x`, `y` is over.
 *
 * Within a row, the midpoint of each tab is the boundary: you have passed a
 * neighbour once the cursor is past its middle, which is the point at which
 * swapping stops feeling early and starts feeling late. Past the last tab of
 * a row means that tab, which on the last row is how you drag something to
 * the back of the strip.
 *
 * The row comes first, because once a strip wraps, two tabs on different
 * rows can sit at the same `x` and asking about `x` alone would pick whichever
 * of them came first.
 */
export function indexAt(extents: readonly Extent[], x: number, y: number): number {
  if (!extents.length) {
    return 0;
  }
  const rows = rowsOf(extents);
  // Dragged above the strip or below it: the nearest row, so a cursor that
  // has wandered off still has somewhere sensible to drop.
  const row =
    rows.find((indices) => {
      const first = extents[indices[0]];
      return y < first.top + first.height;
    }) ?? rows[rows.length - 1];

  for (const index of row) {
    const extent = extents[index];
    if (x < extent.left + extent.width / 2) {
      return index;
    }
  }
  return row[row.length - 1];
}
