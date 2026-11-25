import { fromDb, fromMinor } from '../../accounting/money';
import { numericTransformer, nullableNumericTransformer } from './invoice.entity';

describe('InvoiceEntity numericTransformer (#1074 / LESSONS 8 / LESSONS 28)', () => {
  describe('numericTransformer', () => {
    it('passes through values on to()', () => {
      expect(numericTransformer.to('1234.5600')).toBe('1234.5600');
      expect(numericTransformer.to(1234.56)).toBe(1234.56);
      expect(numericTransformer.to(0)).toBe(0);
      expect(numericTransformer.to(undefined)).toBeUndefined();
      expect(numericTransformer.to(null)).toBeNull();
    });

    it('preserves exact driver string representations without float Number() loss', () => {
      expect(numericTransformer.from('1000.0000')).toBe('1000.0000');
      expect(numericTransformer.from('1234.5678')).toBe('1234.5678');
      expect(numericTransformer.from('0.0000')).toBe('0.0000');
      expect(numericTransformer.from('-500.2500')).toBe('-500.2500');
    });

    it('reads back a 16-integer-digit value with 4 decimals exactly and converts via money.ts without precision loss (LESSONS 8)', () => {
      const large16Digit = '1234567890123456.8901';
      const readBack = numericTransformer.from(large16Digit);
      expect(readBack).toBe('1234567890123456.8901');

      // Convert through modules/accounting/money.ts
      const minor = fromDb(readBack);
      expect(minor.toString()).toBe('123456789012345689'); // rounded to 2 decimal money scale
      expect(fromMinor(minor)).toBe('1234567890123456.89');
    });

    it('fails closed on null, undefined, malformed values, and NaN (LESSONS 28)', () => {
      expect(() => numericTransformer.from(null)).toThrow(/null or undefined/);
      expect(() => numericTransformer.from(undefined)).toThrow(/null or undefined/);
      expect(() => numericTransformer.from('abc')).toThrow(/malformed/);
      expect(() => numericTransformer.from('12.34.56')).toThrow(/malformed/);
      expect(() => numericTransformer.from(NaN)).toThrow(/NaN/);
    });

    it('converts finite numbers to string representation', () => {
      expect(numericTransformer.from(2500)).toBe('2500');
    });
  });

  describe('nullableNumericTransformer', () => {
    it('passes through values on to()', () => {
      expect(nullableNumericTransformer.to('100.5000')).toBe('100.5000');
      expect(nullableNumericTransformer.to(100.5)).toBe(100.5);
      expect(nullableNumericTransformer.to(undefined)).toBeUndefined();
      expect(nullableNumericTransformer.to(null)).toBeNull();
    });

    it('preserves exact driver string representations on from()', () => {
      expect(nullableNumericTransformer.from('750.5000')).toBe('750.5000');
      expect(nullableNumericTransformer.from('98765432101234567.1234')).toBe('98765432101234567.1234');
    });

    it('returns null for null or undefined on from()', () => {
      expect(nullableNumericTransformer.from(null)).toBeNull();
      expect(nullableNumericTransformer.from(undefined)).toBeNull();
    });

    it('fails closed on malformed values and NaN (LESSONS 28)', () => {
      expect(() => nullableNumericTransformer.from('invalid')).toThrow(/malformed/);
      expect(() => nullableNumericTransformer.from(NaN)).toThrow(/NaN/);
    });
  });
});
