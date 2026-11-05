import { MoneyFormatError, fromDb, sumMinor, toMinor } from './money';

describe('money.ts edge cases', () => {
  describe('toMinor', () => {
    it('handles zero values', () => {
      expect(toMinor(0)).toEqual(0n);
      expect(toMinor('0')).toEqual(0n);
      expect(toMinor('0.00')).toEqual(0n);
    });

    it('handles negative values', () => {
      expect(toMinor(-123.45)).toEqual(-12345n);
      expect(toMinor('-123.45')).toEqual(-12345n);
    });

    it('handles very large values above 2^53', () => {
      expect(toMinor('9007199254740992.00')).toEqual(900719925474099200n);
      expect(() => toMinor(9007199254740992)).toThrow(MoneyFormatError);
    });

    it('handles strings with exactly 2 decimals', () => {
      expect(toMinor('1234.56')).toEqual(123456n);
      expect(toMinor('789.01')).toEqual(78901n);
    });

    it('rejects invalid input', () => {
      expect(() => toMinor('1234.567')).toThrow(MoneyFormatError);
      expect(() => toMinor('')).toThrow(MoneyFormatError);
      expect(() => toMinor('abc')).toThrow(MoneyFormatError);
      expect(() => toMinor(NaN)).toThrow(MoneyFormatError);
      expect(() => toMinor(Infinity)).toThrow(MoneyFormatError);
    });
  });

  describe('sumMinor', () => {
    it('handles zero values', () => {
      expect(sumMinor([0, 0])).toEqual(0n);
      expect(sumMinor(['0', '0.00'])).toEqual(0n);
    });

    it('handles negative values', () => {
      expect(sumMinor(['-123.45', '50.25'])).toEqual(-7320n);
    });

    it('handles very large values above 2^53', () => {
      expect(sumMinor(['9007199254740992.00', '1.00'])).toEqual(900719925474099300n);
    });

    it('handles strings with exactly 2 decimals', () => {
      expect(sumMinor(['1234.56', '789.01'])).toEqual(202357n);
    });

    it('rejects invalid input', () => {
      expect(() => sumMinor(['1234.567'])).toThrow(MoneyFormatError);
    });
  });

  describe('fromDb', () => {
    it('rounds half away from zero on the third decimal', () => {
      expect(fromDb('12.345')).toEqual(1235n);
      expect(fromDb('-12.345')).toEqual(-1235n);
    });

    it('keeps the value when the third decimal is below five', () => {
      expect(fromDb('12.344')).toEqual(1234n);
      expect(fromDb('12.349')).toEqual(1235n);
    });

    it('treats null and undefined as zero', () => {
      expect(fromDb(null)).toEqual(0n);
      expect(fromDb(undefined)).toEqual(0n);
    });
  });
});
