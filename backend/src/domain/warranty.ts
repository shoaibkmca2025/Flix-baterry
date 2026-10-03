// Pure, no I/O. `now` is always injected — never `new Date()` inline — so tests never sleep
// and the server always compares against Asia/Kolkata "today" (architecture.md §6.1), not UTC.

/**
 * Calendar-month anniversary minus one day. Same algorithm as src/domain.ts's expiryFrom(),
 * so a value computed here and one already stored from the demo app agree.
 *   expiryFrom('2026-01-10', 24) -> '2028-01-09'
 *   expiryFrom('2024-02-29', 12) -> '2025-02-27' (Feb 2025 has no 29th)
 */
export function expiryFrom(startDate: string, months: number): string {
  const parts = startDate.split('-').map(Number);
  const [y, m, d] = parts;
  if (parts.length !== 3 || y === undefined || m === undefined || d === undefined) {
    throw new Error(`expiryFrom: startDate must be 'YYYY-MM-DD', got '${startDate}'`);
  }
  const daysInTargetMonth = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y, m - 1 + months, Math.min(d, daysInTargetMonth)));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export type WarrantyCheck = {
  mfgMonth: string;
  /** first day of the manufacture month — where the cover is counted from */
  startDate: string;
  expiryDate: string;
  inWarranty: boolean;
  daysRemaining: number;
  /** the model's term (months) and the grace added on top, so the app can explain the number */
  termMonths: number;
  graceMonths: number;
};

export const DEFAULT_TERM_MONTHS = 24;
export const DEFAULT_GRACE_MONTHS = 2;

/**
 * The warranty rule (memory.md D-11, 22 Sep 2026, superseding D-03's sale-date anchor): cover
 * runs from the first day of the MANUFACTURE month printed in the code, for the term the
 * (plate, model) combination carries, plus a grace of `graceMonths` because a battery may sit
 * up to two months between manufacture and sale. So a 24-month M2200 made in April 2026 is
 * covered 2026-04-01 → 2028-05-31. Chains still inherit the first battery's dates unchanged.
 */
export function coverFromMfg(mfgMonth: string, termMonths = DEFAULT_TERM_MONTHS, graceMonths = DEFAULT_GRACE_MONTHS) {
  const startDate = `${mfgMonth}-01`;
  return { startDate, expiryDate: expiryFrom(startDate, termMonths + graceMonths), termMonths, graceMonths };
}

export function checkWarranty(mfgMonth: string, now: string, termMonths = DEFAULT_TERM_MONTHS, graceMonths = DEFAULT_GRACE_MONTHS): WarrantyCheck {
  const cover = coverFromMfg(mfgMonth, termMonths, graceMonths);
  const daysRemaining = Math.ceil((Date.parse(cover.expiryDate) - Date.parse(now)) / 86_400_000);
  return { mfgMonth, ...cover, inWarranty: daysRemaining >= 0, daysRemaining };
}

/**
 * Which kind of replacement a request for this battery is (client, 3 Oct 2026). Cover is the term
 * plus the grace months, but a customer only ever hears "the term" — so a claim inside the grace
 * months, or after the cover is over entirely, is a SPECIAL replacement: the customer still gets
 * the new battery at the counter, but the distributor and then head office must approve it
 * before the old battery can be sent on.
 *
 *   normal      on or before the end of the term
 *   extension   inside the grace months — the new battery still inherits the chain's end date
 *   expired     after the cover — if approved, the new battery has NO warranty at all
 *
 * `daysOver` counts from the end of the term, the date the customer was told.
 */
export type CoverCase = 'normal' | 'extension' | 'expired';
export function coverCase(cover: { startDate: string; expiryDate: string; termMonths: number }, onDate: string): { case: CoverCase; termEnd: string; daysOver: number } {
  // an override can push the expiry past term + grace, never pull the term's end past the expiry
  const termEnd = [expiryFrom(cover.startDate, cover.termMonths), cover.expiryDate].sort()[0]!;
  const daysOver = Math.max(0, Math.round((Date.parse(onDate) - Date.parse(termEnd)) / 86_400_000));
  const kind: CoverCase = onDate <= termEnd ? 'normal' : onDate <= cover.expiryDate ? 'extension' : 'expired';
  return { case: kind, termEnd, daysOver };
}
