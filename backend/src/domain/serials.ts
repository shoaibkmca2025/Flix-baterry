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
  /** normalised code, used for all comparisons/storage. */
  normalised: string;
  valid: boolean;
};

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
  const normalised = normalise(entered);
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
  };
}
