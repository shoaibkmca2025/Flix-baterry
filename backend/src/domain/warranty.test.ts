import { describe, expect, it } from 'vitest';
import { checkWarranty, coverFromMfg, expiryFrom } from './warranty';

describe('expiryFrom', () => {
  // same three cases already proven in tests/domain.test.ts for the frontend — must stay in sync.
  it('10 Jan 2026 + 24 months -> 09 Jan 2028', () => {
    expect(expiryFrom('2026-01-10', 24)).toBe('2028-01-09');
  });
  it('29 Feb 2024 + 12 months -> 27 Feb 2025 (Feb 2025 has no 29th)', () => {
    expect(expiryFrom('2024-02-29', 12)).toBe('2025-02-27');
  });
  it('31 Jan 2026 + 1 month -> 27 Feb 2026', () => {
    expect(expiryFrom('2026-01-31', 1)).toBe('2026-02-27');
  });
});

describe('checkWarranty — manufacture month + term + grace (memory.md D-11)', () => {
  it('a 24-month model made in April 2026 is covered 2026-04-01 → 2028-05-31 (2 grace months)', () => {
    const result = checkWarranty('2026-04', '2026-04-01', 24);
    expect(result).toMatchObject({ startDate: '2026-04-01', expiryDate: '2028-05-31', termMonths: 24, graceMonths: 2, inWarranty: true });
    expect(result.daysRemaining).toBeGreaterThan(700);
  });

  it('the term comes from the (plate, model) row: M2200 at 30 months ends 2028-11-30', () => {
    expect(checkWarranty('2026-04', '2026-04-01', 30).expiryDate).toBe('2028-11-30');
    expect(checkWarranty('2026-04', '2026-04-01', 30, 0).expiryDate).toBe('2028-09-30'); // grace is a setting
  });

  it('battery manufactured 3 years ago -> expired', () => {
    const result = checkWarranty('2023-01', '2026-09-16', 24);
    expect(result.inWarranty).toBe(false);
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it('checked exactly on the expiry date -> still in warranty (inclusive)', () => {
    const result = checkWarranty('2026-04', '2028-05-31', 24);
    expect(result.daysRemaining).toBe(0);
    expect(result.inWarranty).toBe(true);
  });

  it('coverFromMfg is what a new chain is anchored on', () => {
    expect(coverFromMfg('2026-09', 24)).toEqual({ startDate: '2026-09-01', expiryDate: '2028-10-31', termMonths: 24, graceMonths: 2 });
  });
});
