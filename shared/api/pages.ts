/**
 * The list endpoints answer one page (200 rows) and a `nextCursor` for the rest. The apps hold
 * the whole register in the store and compute from it — counts, queues, "still at dealers",
 * whether a challan is finished — so a list that stops at 200 is not a shorter list, it is a
 * wrong answer, and a silent one (the audit log already passes 200 in production).
 *
 * `allPages` takes the page already in hand — from GET /sync, or from the list call itself —
 * and follows the cursor to the end. MAX_PAGES stops a runaway cursor from looping for ever;
 * hitting it leaves `nextCursor` set rather than passing the part off as the whole.
 */
export type Page<T> = { items: T[]; nextCursor: string | null };

export const MAX_PAGES = 25; // 5,000 rows per list

export async function allPages<T>(first: Page<T>, more: (cursor: string) => Promise<Page<T>>): Promise<Page<T>> {
  const items = [...first.items];
  let cursor = first.nextCursor;
  for (let page = 1; cursor && page < MAX_PAGES; page++) {
    const next = await more(cursor);
    items.push(...next.items);
    cursor = next.nextCursor;
  }
  return { items, nextCursor: cursor };
}
