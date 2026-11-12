import {
  MoneyFormatError,
  fromDb,
  minorToMillionRials,
  rialsToMillionRials,
  sumMinor,
  toMinor,
} from './money';

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

  describe('minorToMillionRials and rialsToMillionRials', () => {
    it('minorToMillionRials converts exact minor units without floats', () => {
      expect(minorToMillionRials(0n)).toBe('0');
      // 1 Rial = 100 minor units -> 0.000001 million rials
      expect(minorToMillionRials(100n)).toBe('0.000001');
      // 1,000,000 Rials = 100,000,000 minor units -> 1 million rials
      expect(minorToMillionRials(100_000_000n)).toBe('1');
      // 2,500,000 Rials = 250,000,000 minor units -> 2.5 million rials
      expect(minorToMillionRials(250_000_000n)).toBe('2.5');
      // 50,000,000 Rials = 5,000,000,000 minor units -> 50 million rials
      expect(minorToMillionRials(5_000_000_000n)).toBe('50');
      // Negative
      expect(minorToMillionRials(-100_000_000n)).toBe('-1');
      expect(minorToMillionRials(-250_000_000n)).toBe('-2.5');
    });

    it('rialsToMillionRials converts whole rials without floats', () => {
      expect(rialsToMillionRials(0n)).toBe('0');
      expect(rialsToMillionRials(1n)).toBe('0.000001');
      expect(rialsToMillionRials(1_000_000n)).toBe('1');
      expect(rialsToMillionRials(2_500_000n)).toBe('2.5');
      expect(rialsToMillionRials(50_000_000n)).toBe('50');
      expect(rialsToMillionRials(-1_000_000n)).toBe('-1');
    });
  });
});
