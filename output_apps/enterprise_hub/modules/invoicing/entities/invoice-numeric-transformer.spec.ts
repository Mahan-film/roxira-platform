import { numericTransformer, nullableNumericTransformer } from './invoice.entity';

describe('InvoiceEntity numericTransformer (#1074 / LESSONS 8)', () => {
  describe('numericTransformer', () => {
    it('passes through numbers, undefined and null on to()', () => {
      expect(numericTransformer.to(1234.56)).toBe(1234.56);
      expect(numericTransformer.to(0)).toBe(0);
      expect(numericTransformer.to(undefined)).toBeUndefined();
      expect(numericTransformer.to(null)).toBeNull();
    });

    it('transforms database numeric string representations to numbers on from()', () => {
      expect(numericTransformer.from('1000.0000')).toBe(1000);
      expect(numericTransformer.from('1234.5678')).toBe(1234.5678);
      expect(numericTransformer.from('0.0000')).toBe(0);
      expect(numericTransformer.from('-500.2500')).toBe(-500.25);
    });

    it('returns existing number if driver already converted to number on from()', () => {
      expect(numericTransformer.from(2500)).toBe(2500);
    });

    it('returns 0 for null or undefined on from()', () => {
      expect(numericTransformer.from(null)).toBe(0);
      expect(numericTransformer.from(undefined)).toBe(0);
    });
  });

  describe('nullableNumericTransformer', () => {
    it('passes through numbers, undefined and null on to()', () => {
      expect(nullableNumericTransformer.to(100.5)).toBe(100.5);
      expect(nullableNumericTransformer.to(undefined)).toBeUndefined();
      expect(nullableNumericTransformer.to(null)).toBeNull();
    });

    it('transforms database numeric string to number on from()', () => {
      expect(nullableNumericTransformer.from('750.5000')).toBe(750.5);
      expect(nullableNumericTransformer.from(750.5)).toBe(750.5);
    });

    it('returns null for null or undefined on from()', () => {
      expect(nullableNumericTransformer.from(null)).toBeNull();
      expect(nullableNumericTransformer.from(undefined)).toBeNull();
    });
  });
});
