// Pure, no I/O, no ambient clock — ported from src/domain.ts (deriveCode) so the app's demo
// logic and the backend never disagree about what a serial means. See architecture.md §9.2.

export function normalise(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export type DerivedCode = {
  /** '2026-04' — manufacture year+month, or null if the code doesn't parse. */
  mfgMonth: string | null;
  /** last 4 digits, kept as text — leading zeros matter (I-4). */
  serialNo: string;
  /** the code as originally entered, before normalisation. */
  entered: string;
  /** the 8-digit battery code, used for all comparisons/storage (never includes the prefix). */
  normalised: string;
  valid: boolean;
  /** plate letter from a prefixed label ('M2200-26041212' → 'M'), or null when the code had none. */
  plate: string | null;
  /** model number from a prefixed label ('2200'), or null. */
  modelNo: string | null;
  /** plate + modelNo ('M2200') — the battery_models id the label names, or null. */
  modelId: string | null;
};

// The printed label may carry the plate letter and model number in front of the 8 digits
// (memory.md D-11): 'M2200-26041212', 'M2200 26041212' or 'M220026041212'. The prefix is
// informative (it pre-fills the dealer's dropdowns); the 8 digits are the battery's identity.
const PREFIXED = /^([A-Z])(\d{3,4})-?(\d{8})$/;

// Default rule: 8 digits, first 2 = YY, next 2 = MM, last 4 = random serial.
// A per-family override (serial_rules table) can replace this once masters exist (P1-01) —
// this function takes the rule's shape as an optional param so that swap is a call-site change,
// not a rewrite.
export function deriveCode(
  entered: string,
  rule: { pattern: RegExp; shortSerialFrom: number; shortSerialLen: number } = {
    pattern: /^\d{8}$/,
    shortSerialFrom: 5, // 1-indexed, matches architecture.md §9.2
    shortSerialLen: 4,
  },
): DerivedCode {
  const whole = normalise(entered);
  const prefixed = PREFIXED.exec(whole);
  const normalised = prefixed ? prefixed[3]! : whole;
  const plate = prefixed ? prefixed[1]! : null;
  const modelNo = prefixed ? prefixed[2]! : null;
  const formatOk = rule.pattern.test(normalised);

  const yy = normalised.slice(0, 2);
  const mm = normalised.slice(2, 4);
  const month = Number(mm);
  const monthOk = formatOk && month >= 1 && month <= 12;

  const serialNo = normalised.slice(rule.shortSerialFrom - 1, rule.shortSerialFrom - 1 + rule.shortSerialLen);

  return {
    mfgMonth: monthOk ? `20${yy}-${mm}` : null,
    serialNo,
    entered,
    normalised,
    valid: formatOk && monthOk,
    plate,
    modelNo,
    modelId: plate && modelNo ? `${plate}${modelNo}` : null,
  };
}
