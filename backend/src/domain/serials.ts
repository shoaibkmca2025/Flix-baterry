// Pure, no I/O, no ambient clock — ported from src/domain.ts (deriveCode) so the app's demo
// logic and the backend never disagree about what a serial means. See architecture.md §9.2.

export function normalise(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Everything a label can be written with, removed: spaces, hyphens, dots, slashes. */
export function normaliseLabel(input: string): string {
  return input.trim().toUpperCase().replace(/[\s\-._/]+/g, '');
}

/**
 * How many digits the number after the model can have. Felix's plants do not agree: the main
 * one prints 8 (`M1300 2608 0001`) and 7 (`S2000 2607 001`), and the other two are said to use
 * different lengths again (memory.md D-18). Every known form is the same underneath —
 * **YYMM then the serial** — so the rule is one rule and only the length varies, which is why
 * this is a setting (`serials.digit_lengths`) rather than a constant: a new plant is a row to
 * change, not a release.
 */
export const DEFAULT_DIGIT_LENGTHS = [7, 8] as const;
/** Batteries made now all carry 8 digits (client, 27 Sep 2026). Only batteries ALREADY in the field
 * (an old battery coming back, a sales return) can have the older 7-digit form, so those follow
 * the `serials.digit_lengths` setting while a new battery is always held to this. */
export const NEW_BATTERY_DIGIT_LENGTHS = [8] as const;
const MONTH_DIGITS = 4;

export type DerivedCode = {
  /** '2026-04' — manufacture year+month, or null if the code doesn't parse. */
  mfgMonth: string | null;
  /** the serial after the YYMM, kept as text — leading zeros matter (I-4). */
  serialNo: string;
  /** the code as originally entered, before normalisation. */
  entered: string;
  /** the digits (YYMM + serial). NOT unique on its own — see fullCode(). */
  normalised: string;
  valid: boolean;
  /**
   * The battery_models id the label names ('M1000', 'GPM1000', 'SG2200'), or null when the
   * label carried only digits. The plate code and model number are columns on that row —
   * 'K60L' cannot be split into 'K' + '60L' by shape alone, so read them from the catalogue.
   */
  modelId: string | null;
};

const isDigits = (v: string) => /^\d+$/.test(v);

/** YYMM at the front, and a month that exists. */
function monthOf(digits: string): string | null {
  if (digits.length <= MONTH_DIGITS || !isDigits(digits)) return null;
  const month = Number(digits.slice(2, 4));
  return month >= 1 && month <= 12 ? `20${digits.slice(0, 2)}-${digits.slice(2, 4)}` : null;
}

const sortedLengths = (lengths: readonly number[]) => [...new Set(lengths)].sort((a, b) => b - a);

/**
 * Splits a scanned or typed label into the product it names and its digits.
 *
 * The printed forms all exist in the field (client's samples, 25–27 Sep 2026):
 *   "M 1300 2608 0001"      code, model, then 8 digits
 *   "S 2000 2607 001"       the same with a 7-digit number
 *   "GP M 1000 2609 0075"   Gold Power brand in front
 *   "SS 2500 2609 0493"     two-character tubular series code
 *   "IT 2200 SG 1125 0058"  tubular, code AFTER the model, with the range prefix
 *   "I Din 50 …" / "K 60L" / "O H29"   model numbers that are not plain digits
 *
 * A regex cannot separate "K60L" into K + 60L reliably, so this matches against the ids the
 * catalogue actually holds — longest first, so 'GPM1000' wins over 'M1000'. Lengths are tried
 * longest first too, and a length only wins if what is left is a model we know, which is what
 * keeps "S2000" + 7 digits from being read as "S200" + 8.
 */
export function splitLabel(
  input: string,
  knownModelIds: readonly string[] = [],
  lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS,
): { modelId: string | null; code: string } {
  const whole = normaliseLabel(input);
  const tryLengths = sortedLengths(lengths);

  // just the digits, no product named
  if (isDigits(whole) && tryLengths.includes(whole.length)) return { modelId: null, code: whole };

  const ids = [...knownModelIds].sort((a, b) => b.length - a.length);
  for (const len of tryLengths) {
    const tail = whole.slice(-len);
    const head = whole.slice(0, -len);
    if (!head || !isDigits(tail) || !monthOf(tail)) continue;

    if (ids.includes(head)) return { modelId: head, code: tail };

    // "IT2200SG" / "FT2500SS" — range prefix, model, then the code. Rebuild it as code+model.
    const swapped = /^(?:IT|FT)?(\d{3,4})([A-Z][A-Z0-9]?)$/.exec(head);
    if (swapped) {
      const rebuilt = `${swapped[2]}${swapped[1]}`;
      if (ids.includes(rebuilt)) return { modelId: rebuilt, code: tail };
    }
    const endsWith = ids.find((id) => head.endsWith(id)); // an unknown brand prefix in front
    if (endsWith) return { modelId: endsWith, code: tail };
  }

  // The label named something the catalogue does not have. Hand back the digits anyway —
  // preferring a tail that actually looks like YYMM — so the caller can say "we don't know
  // that model" rather than the misleading "that is not a valid number".
  const fallback = tryLengths.find((len) => monthOf(whole.slice(-len))) ?? tryLengths.find((len) => isDigits(whole.slice(-len)));
  return { modelId: null, code: fallback ? whole.slice(-fallback) : whole };
}

/** The battery's identity as printed on it: the product code and the digits together. */
export function fullCode(modelId: string, code: string): string {
  return `${normaliseLabel(modelId)}${normalise(code)}`;
}

/** The digits half of a stored identity — exact, because the product prefix is known. */
export function digitsOfFull(batteryCode: string, modelId: string): string {
  const prefix = normaliseLabel(modelId);
  return batteryCode.startsWith(prefix) ? batteryCode.slice(prefix.length) : batteryCode;
}

/**
 * Reads a code that is ALREADY on record, where the length was checked when it was written.
 * Deliberately length-agnostic: a plant whose length is added to the setting later must not
 * make years of stored batteries unreadable (memory.md D-18).
 */
export function readStored(digits: string): { mfgMonth: string | null; serialNo: string } {
  return { mfgMonth: monthOf(digits), serialNo: digits.slice(MONTH_DIGITS) };
}

/** "a 7- or 8-digit number" — for error messages, so they name what is actually accepted. */
// "an 8-digit", "an 11-digit", "an 18-digit" — the article follows how the number is said aloud
const article = (n: number) => (/^(8|11|18)/.test(String(n)) ? 'an' : 'a');
export function lengthsSentence(lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS): string {
  const sorted = [...new Set(lengths)].sort((a, b) => a - b);
  if (sorted.length === 1) return `${article(sorted[0]!)} ${sorted[0]}-digit number`;
  return `${article(sorted[0]!)} ${sorted.slice(0, -1).join(', ')}- or ${sorted[sorted.length - 1]}-digit number`;
}

export function deriveCode(
  entered: string,
  knownModelIds: readonly string[] = [],
  lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS,
): DerivedCode {
  const { modelId, code: normalised } = splitLabel(entered, knownModelIds, lengths);
  const lengthOk = sortedLengths(lengths).includes(normalised.length);
  const mfgMonth = lengthOk ? monthOf(normalised) : null;

  return {
    mfgMonth,
    serialNo: normalised.slice(MONTH_DIGITS),
    entered,
    normalised,
    valid: mfgMonth !== null,
    modelId,
  };
}
