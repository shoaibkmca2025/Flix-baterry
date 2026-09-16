import { describe, expect, it } from 'vitest';
import { checkWarranty, expiryFrom } from './warranty';

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

describe('checkWarranty (V1 stateless rule — memory.md D-03, open)', () => {
  it('battery manufactured 2026-04, checked same day -> in warranty, ~24 months left', () => {
    const result = checkWarranty('2026-04', '2026-04-01', 24);
    expect(result.expiryDate).toBe('2028-03-31');
    expect(result.inWarranty).toBe(true);
    expect(result.daysRemaining).toBeGreaterThan(700);
  });

  it('battery manufactured 3 years ago -> expired', () => {
    const result = checkWarranty('2023-01', '2026-09-16', 24);
    expect(result.inWarranty).toBe(false);
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it('checked exactly on the expiry date -> still in warranty (inclusive)', () => {
    const result = checkWarranty('2026-04', '2028-03-31', 24);
    expect(result.daysRemaining).toBe(0);
    expect(result.inWarranty).toBe(true);
  });
});
