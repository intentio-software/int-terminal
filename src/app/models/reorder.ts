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

/** A tab's horizontal extent, as the strip sees it. */
export interface Extent {
  left: number;
  width: number;
}

/**
 * The index a cursor at `x` is over.
 *
 * The midpoint of each tab is the boundary: you have passed a neighbour once
 * the cursor is past its middle, which is the point at which swapping stops
 * feeling early and starts feeling late.
 *
 * Past the last tab means the end, which is how you drag something to the
 * back of the strip.
 */
export function indexAt(extents: readonly Extent[], x: number): number {
  const at = extents.findIndex((extent) => x < extent.left + extent.width / 2);
  return at === -1 ? Math.max(0, extents.length - 1) : at;
}
