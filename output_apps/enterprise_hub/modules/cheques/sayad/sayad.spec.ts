import {
  isValidLegalNationalId,
  isValidNationalCode,
  isValidReceiverNationalId,
  isValidSayadNumber,
  toLatinDigits,
} from './sayad';

describe('sayad format checks', () => {
  it('accepts exactly 16 digits and rejects other lengths, letters and one repeated digit', () => {
    expect(isValidSayadNumber('1234567890123456')).toBe(true);
    expect(isValidSayadNumber('123456789012345')).toBe(false);
    expect(isValidSayadNumber('12345678901234567')).toBe(false);
    expect(isValidSayadNumber('12345678901234ab')).toBe(false);
    expect(isValidSayadNumber('0000000000000000')).toBe(false);
    expect(isValidSayadNumber('')).toBe(false);
  });

  it('converts Persian and Arabic-Indic digits', () => {
    expect(toLatinDigits(' ۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶ ')).toBe('1234567890123456');
    expect(toLatinDigits('٠١٢')).toBe('012');
  });

  it('national code: mod-11 check digit', () => {
    expect(isValidNationalCode('0499370899')).toBe(true);
    expect(isValidNationalCode('0499370890')).toBe(false);
    expect(isValidNationalCode('1111111111')).toBe(false);
    expect(isValidNationalCode('049937089')).toBe(false);
  });

  it('legal national id: 11 digits with a weighted check digit', () => {
    // build a valid id from a prefix by trying the last digit, so the test does not hard-code a registry value
    const prefix = '1010000001';
    const valid = [...Array(10).keys()].map((d) => prefix + d).filter(isValidLegalNationalId);
    expect(valid).toHaveLength(1);
    const bad = prefix + ((Number(valid[0].slice(-1)) + 1) % 10);
    expect(isValidLegalNationalId(bad)).toBe(false);
    expect(isValidLegalNationalId('1234567890')).toBe(false);
  });

  it('receiver id dispatches on length', () => {
    expect(isValidReceiverNationalId('0499370899')).toBe(true);
    expect(isValidReceiverNationalId('12345')).toBe(false);
  });
});
