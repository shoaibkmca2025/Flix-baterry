import { AppError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () =>
  new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');

/**
 * The "where was I" marker on a page of results, checked before it reaches a query.
 *
 * Every list endpoint decoded its own cursor and only caught a JSON parse error. A cursor that
 * parsed but carried nonsense — `{"createdAt":"bad-date","id":"not-uuid"}` — sailed through as an
 * Invalid Date and a non-UUID, and Postgres threw: seven endpoints answered 500 to a string
 * anybody can put in a URL (QA, 6 Oct 2026).
 *
 * `field` is the timestamp each list sorts by, which differs — `at` on the audit log, `issuedAt`
 * on credit notes, `postedAt` on stock movements — so one decoder serves them all.
 */
export function decodeCursor<F extends string, K extends 'uuid' | 'number' = 'uuid'>(
  cursor: string | undefined,
  field: F,
  idKind: K = 'uuid' as K,
) {
  if (!cursor) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!raw || typeof raw !== 'object') throw invalid();
  const { [field]: at, id } = raw as Record<string, unknown>;
  if (typeof at !== 'string') throw invalid();
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw invalid();

  // the audit log is numbered by a bigserial; everything else is keyed by uuid
  if (idKind === 'number') {
    const n = typeof id === 'number' ? id : Number(id);
    if (!Number.isSafeInteger(n) || n < 0) throw invalid();
    return { [field]: when, id: n } as { [P in F]: Date } & { id: K extends 'number' ? number : string };
  }
  if (typeof id !== 'string' || !UUID.test(id)) throw invalid();
  return { [field]: when, id } as { [P in F]: Date } & { id: K extends 'number' ? number : string };
}
