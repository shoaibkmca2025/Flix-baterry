// Pure, no I/O, no ambient clock — ported from src/domain.ts (deriveCode) so the app's demo
// logic and the backend never disagree about what a serial means. See architecture.md §9.2.

export function normalise(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Everything a label can be written with, removed: spaces, hyphens, dots, slashes. */
export function normaliseLabel(input: string): string {
  return input.trim().toUpperCase().replace(/[\s\-._/]+/g, '');
}

export type DerivedCode = {
  /** '2026-04' — manufacture year+month, or null if the code doesn't parse. */
  mfgMonth: string | null;
  /** last 4 digits, kept as text — leading zeros matter (I-4). */
  serialNo: string;
  /** the code as originally entered, before normalisation. */
  entered: string;
  /** the 8 digits (YYMM + serial). NOT unique on its own — see fullCode(). */
  normalised: string;
  valid: boolean;
  /**
   * The battery_models id the label names ('M1000', 'GPM1000', 'SG2200'), or null when the
   * label carried only digits. The plate code and model number are columns on that row —
   * 'K60L' cannot be split into 'K' + '60L' by shape alone, so read them from the catalogue.
   */
  modelId: string | null;
};

// Default rule: 8 digits, first 2 = YY, next 2 = MM, last 4 = the serial. The serial restarts
// at 1 on the 26th of every month AND counts separately per product (client, 25 Sep 2026), so
// "M1000 26090001" and "S1000 26090001" are two different batteries — see fullCode().
const DIGITS = /^\d{8}$/;

/**
 * Splits a scanned or typed label into the product it names and its 8 digits.
 *
 * The printed forms all exist in the field (client's samples, 25 Sep 2026):
 *   "M 1000 2609 0676"      code then model
 *   "GP M 1000 2609 0075"   Gold Power brand in front
 *   "SS 2500 2609 0493"     two-character tubular series code
 *   "IT 2200 SG 1125 0058"  tubular, code AFTER the model, with the range prefix
 *   "I Din 75 …" / "K 60L" / "O H29"   model numbers that are not plain digits
 *
 * A regex cannot separate "K60L" into K + 60L reliably, so this matches against the ids the
 * catalogue actually holds — longest first, so 'GPM1000' wins over 'M1000'.
 */
export function splitLabel(input: string, knownModelIds: readonly string[] = []): { modelId: string | null; code: string } {
  const whole = normaliseLabel(input);
  if (DIGITS.test(whole)) return { modelId: null, code: whole }; // just the digits

  const tail = whole.slice(-8);
  const head = whole.slice(0, -8);
  if (!DIGITS.test(tail) || !head) return { modelId: null, code: whole };

  const ids = [...knownModelIds].sort((a, b) => b.length - a.length);
  const direct = ids.find((id) => id === head);
  if (direct) return { modelId: direct, code: tail };

  // "IT2200SG" / "FT2500SS" — range prefix, model, then the code. Rebuild it as code+model.
  const swapped = /^(?:IT|FT)?(\d{3,4})([A-Z][A-Z0-9]?)$/.exec(head);
  if (swapped) {
    const rebuilt = `${swapped[2]}${swapped[1]}`;
    if (ids.includes(rebuilt)) return { modelId: rebuilt, code: tail };
  }
  // an unknown product still yields its digits; the caller decides whether that is an error
  return { modelId: ids.find((id) => head.endsWith(id)) ?? null, code: tail };
}

/** The battery's identity as printed on it: the product code and the 8 digits together. */
export function fullCode(modelId: string, code: string): string {
  return `${normaliseLabel(modelId)}${normalise(code)}`;
}

export function deriveCode(entered: string, knownModelIds: readonly string[] = []): DerivedCode {
  const { modelId, code: normalised } = splitLabel(entered, knownModelIds);
  const formatOk = DIGITS.test(normalised);

  const yy = normalised.slice(0, 2);
  const mm = normalised.slice(2, 4);
  const month = Number(mm);
  const monthOk = formatOk && month >= 1 && month <= 12;

  return {
    mfgMonth: monthOk ? `20${yy}-${mm}` : null,
    serialNo: normalised.slice(4, 8),
    entered,
    normalised,
    valid: formatOk && monthOk,
    modelId,
  };
}
