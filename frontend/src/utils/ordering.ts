/**
 * Generic ordering helpers for the up/down-arrow reordering used across sensors,
 * sensor groups and virtual sensors (and later fans / system cards). No drag-and-drop.
 *
 * Order is stored server-side as a nullable `sort_order` integer per row. NULL means
 * "unordered": it sorts last and falls back to a caller-supplied stable tiebreaker, so
 * lists look exactly as they do today until a user explicitly arranges them.
 */

const UNORDERED = Number.MAX_SAFE_INTEGER;

/**
 * Move the item `id` one slot up or down within `ids`, returning a new array.
 * Out-of-range moves (first item up, last item down) return the input unchanged.
 */
export function moveInOrder<T>(ids: T[], id: T, dir: 'up' | 'down'): T[] {
  const i = ids.indexOf(id);
  if (i === -1) return ids;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * Return an order-aware copy of `items`:
 *  - primary key: numeric `sort_order` (via getOrder); NULL/undefined sorts last
 *  - tiebreaker: caller-supplied comparator (e.g. the existing alphabetical default)
 * Array.prototype.sort is stable, so equal keys keep their incoming relative order.
 */
export function sortByOrder<T>(
  items: T[],
  getOrder: (item: T) => number | null | undefined,
  tiebreak?: (a: T, b: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const oa = getOrder(a) ?? UNORDERED;
    const ob = getOrder(b) ?? UNORDERED;
    if (oa !== ob) return oa - ob;
    return tiebreak ? tiebreak(a, b) : 0;
  });
}
