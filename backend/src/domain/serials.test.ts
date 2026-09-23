import { describe, expect, it } from 'vitest';
import { deriveCode, normalise } from './serials';

describe('deriveCode', () => {
  it('splits the example from the team: 26041212 -> mfg 2026-04, serial 1212', () => {
    expect(deriveCode('26041212')).toEqual({
      mfgMonth: '2026-04',
      serialNo: '1212',
      entered: '26041212',
      normalised: '26041212',
      valid: true,
      plate: null,
      modelNo: null,
      modelId: null,
    });
  });

  it("reads the plate and model from a prefixed label — 'M2200-26041212', with a space, or run together", () => {
    for (const label of ['M2200-26041212', 'm2200 26041212', 'M220026041212']) {
      expect(deriveCode(label)).toMatchObject({ plate: 'M', modelNo: '2200', modelId: 'M2200', normalised: '26041212', mfgMonth: '2026-04', serialNo: '1212', valid: true });
    }
    expect(deriveCode('N700-25091006')).toMatchObject({ modelId: 'N700', normalised: '25091006' });
  });

  it('keeps leading zeros in the serial (I-4)', () => {
    expect(deriveCode('21030047').serialNo).toBe('0047');
  });

  it('rejects an impossible month', () => {
    expect(deriveCode('26131212').valid).toBe(false);
  });

  it('rejects the wrong number of digits', () => {
    expect(deriveCode('123').valid).toBe(false);
  });

  it('normalises whitespace and case before parsing', () => {
    expect(deriveCode(' 2604 1212 ').normalised).toBe('26041212');
  });
});

describe('normalise', () => {
  it('trims, uppercases, strips internal whitespace', () => {
    expect(normalise('  ab 12 ')).toBe('AB12');
  });
});
