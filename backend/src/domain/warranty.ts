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
  expiryDate: string;
  inWarranty: boolean;
  daysRemaining: number;
};

/**
 * V1 rule (memory.md D-03, open — no chain/inheritance yet): a battery's own warranty is its
 * own manufacture month + termMonths, recalculated fresh every time. Isolated in this one
 * function so switching to sale-date-anchored, chain-inherited warranty later (the documented
 * long-term design) means changing this function's body, not every call site.
 */
export function checkWarranty(mfgMonth: string, now: string, termMonths = 24): WarrantyCheck {
  const expiryDate = expiryFrom(`${mfgMonth}-01`, termMonths);
  const daysRemaining = Math.ceil((Date.parse(expiryDate) - Date.parse(now)) / 86_400_000);
  return { mfgMonth, expiryDate, inWarranty: daysRemaining >= 0, daysRemaining };
}
