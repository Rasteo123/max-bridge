/**
 * MAX serves history as "the N messages before this moment", so paging
 * backwards moves the moment rather than an offset. The cursor carries the
 * oldest message the reader already holds.
 *
 * Anything unparseable falls back to the newest end on purpose: a NaN would
 * travel into the wire request as `from` and come back as an empty chat.
 */
export function historyWindowStart(
  cursor: string | undefined,
  now: number
): number {
  if (cursor === undefined) {
    return now;
  }
  const parsed = Date.parse(cursor);
  return Number.isFinite(parsed) ? parsed : now;
}
