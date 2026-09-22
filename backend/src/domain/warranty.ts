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
