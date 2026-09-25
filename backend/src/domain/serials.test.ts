import { describe, expect, it } from 'vitest';
import { deriveCode, fullCode, normalise, splitLabel } from './serials';

const IDS = ['M1000', 'GPM1000', 'S1000', 'M2200', 'N2200', 'SG2200', 'SS2500', 'K60L', 'IDIN75'];

describe('deriveCode', () => {
  it('splits the example from the team: 26041212 -> mfg 2026-04, serial 1212', () => {
    expect(deriveCode('26041212')).toEqual({
      mfgMonth: '2026-04',
      serialNo: '1212',
      entered: '26041212',
      normalised: '26041212',
      valid: true,
      modelId: null,
    });
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

describe('splitLabel — the printed forms the client actually uses', () => {
  it('reads the product from a label, however it is spaced or punctuated', () => {
    for (const label of ['M1000 2609 0676', 'm1000-26090676', 'M 1000 26090676']) {
      expect(splitLabel(label, IDS)).toEqual({ modelId: 'M1000', code: '26090676' });
    }
  });

  it('keeps the Gold Power brand apart from the plain product', () => {
    expect(splitLabel('GP M 1000 2609 0075', IDS)).toEqual({ modelId: 'GPM1000', code: '26090075' });
    expect(splitLabel('M 1000 2609 0075', IDS)).toEqual({ modelId: 'M1000', code: '26090075' });
  });

  it('reads a two-character tubular series code', () => {
    expect(splitLabel('SS 2500 26090493', IDS)).toEqual({ modelId: 'SS2500', code: '26090493' });
  });

  it('reads the tubular form where the code comes AFTER the model, with the range prefix', () => {
    expect(splitLabel('IT 2200 SG 2609 0058', IDS)).toEqual({ modelId: 'SG2200', code: '26090058' });
    expect(splitLabel('FT2500SS26090493', IDS)).toEqual({ modelId: 'SS2500', code: '26090493' });
  });

  it('handles model numbers that are not plain digits — K 60L, I Din 75', () => {
    expect(splitLabel('K 60L 2609 0002', IDS)).toEqual({ modelId: 'K60L', code: '26090002' });
    expect(splitLabel('I Din 75 2609 0001', IDS)).toEqual({ modelId: 'IDIN75', code: '26090001' });
  });

  it('digits on their own name no product — the caller has to supply one', () => {
    expect(splitLabel('26090676', IDS)).toEqual({ modelId: null, code: '26090676' });
  });
});

describe('fullCode — the identity that is actually unique', () => {
  it('joins product and digits, because the serial repeats across products (D-13)', () => {
    expect(fullCode('M1000', '26090001')).toBe('M100026090001');
    expect(fullCode('S1000', '26090001')).toBe('S100026090001');
    expect(fullCode('M1000', '26090001')).not.toBe(fullCode('S1000', '26090001'));
  });

  it('normalises whatever the dealer typed', () => {
    expect(fullCode('gp m1000', ' 2609 0001 ')).toBe('GPM100026090001');
  });
});

describe('normalise', () => {
  it('trims, uppercases, strips internal whitespace', () => {
    expect(normalise('  ab 12 ')).toBe('AB12');
  });
});
