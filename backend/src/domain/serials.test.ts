import { describe, expect, it } from 'vitest';
import { anyDigitLengths, deriveCode, digitsOfFull, fullCode, lengthsSentence, normalise, readStored, splitLabel } from './serials';

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

describe('serial length varies by plant (memory.md D-18)', () => {
  const IDS2 = ['M1300', 'S2000', 'S200'];

  it("reads the client's two real forms: 8 digits and 7", () => {
    expect(deriveCode('M 1300 2608 0001', IDS2)).toMatchObject({ modelId: 'M1300', normalised: '26080001', mfgMonth: '2026-08', serialNo: '0001', valid: true });
    expect(deriveCode('S 2000 2607 001', IDS2)).toMatchObject({ modelId: 'S2000', normalised: '2607001', mfgMonth: '2026-07', serialNo: '001', valid: true });
  });

  it('picks the length that leaves a model we actually know, not the longest one', () => {
    // 'S2000' + 7 digits could also be read as 'S200' + 8 — but '02607001' is month 60, so it loses
    expect(splitLabel('S20002607001', IDS2)).toEqual({ modelId: 'S2000', code: '2607001' });
  });

  it('keeps leading zeros at either length (I-4)', () => {
    expect(deriveCode('2607001').serialNo).toBe('001');
    expect(deriveCode('26070001').serialNo).toBe('0001');
  });

  it('rejects a length the plants do not use, and says which are accepted', () => {
    expect(deriveCode('260700').valid).toBe(false); // 6 digits — no plant prints it
    // deriveCode's default is the SETTING ([7, 8] — what is already in the field), not the
    // new-battery list, so 9 digits is still invalid here; see anyDigitLengths for the union.
    expect(deriveCode('260700012').valid).toBe(false);
    expect(deriveCode('260700012', [], anyDigitLengths([7, 8])).valid).toBe(true); // ...and valid as one we issue
    expect(lengthsSentence([7, 8])).toBe('a 7- or 8-digit number');
    expect(lengthsSentence([7, 8, 9])).toBe('a 7-, 8- or 9-digit number');
    expect(lengthsSentence([6, 7, 8, 9])).toBe('a 6-, 7-, 8- or 9-digit number');
  });

  it('anyDigitLengths unions the setting with the new-battery forms, sorted and deduped', () => {
    expect(anyDigitLengths([7, 8])).toEqual([7, 8, 9]);
    expect(anyDigitLengths([])).toEqual([7, 8, 9]);
    expect(anyDigitLengths([10, 7])).toEqual([7, 8, 9, 10]); // a plant added to the setting still counts
  });

  it('a new plant is a settings change, not a release — 6 and 9 work the moment they are allowed', () => {
    expect(deriveCode('260700', [], [6, 7, 8, 9])).toMatchObject({ mfgMonth: '2026-07', serialNo: '00', valid: true });
    expect(deriveCode('260700012', [], [6, 7, 8, 9])).toMatchObject({ mfgMonth: '2026-07', serialNo: '00012', valid: true });
  });

  it('a code already on record stays readable whatever the setting says today', () => {
    expect(readStored('260700012')).toEqual({ mfgMonth: '2026-07', serialNo: '00012' }); // 9 digits, not in [7,8]
    expect(digitsOfFull('S20002607001', 'S2000')).toBe('2607001');
    expect(digitsOfFull('M130026080001', 'M1300')).toBe('26080001');
  });

  it('identity still needs the product, at any length', () => {
    expect(fullCode('S2000', '2607001')).toBe('S20002607001');
    expect(fullCode('M1300', '2607001')).not.toBe(fullCode('S2000', '2607001'));
  });
});
