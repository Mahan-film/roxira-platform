import { numericTransformer } from './numeric-column.transformer';

describe('NumericColumnTransformer', () => {
  const transformer = numericTransformer;

  describe('to()', () => {
    it('should pass numbers through unchanged', () => {
      expect(transformer.to(42)).toBe(42);
    });

    it('should pass numeric strings through unchanged', () => {
      // to() is the identity transform; Postgres receives the string as-is.
      expect(transformer.to('42' as unknown as number)).toBe('42');
    });

    it('should return null for null input', () => {
      expect(transformer.to(null)).toBeNull();
    });

    it('should return undefined for undefined input', () => {
      expect(transformer.to(undefined)).toBeUndefined();
    });
  });

  describe('from()', () => {
    it('should convert numbers to numbers', () => {
      expect(transformer.from(42)).toBe(42);
    });

    it('should convert numeric strings to numbers', () => {
      expect(transformer.from('42')).toBe(42);
    });

    it('should return 0 for null input', () => {
      expect(transformer.from(null)).toBe(0);
    });

    it('should return 0 for undefined input', () => {
      expect(transformer.from(undefined)).toBe(0);
    });
  });

  describe('round trip', () => {
    it('should maintain value through to() and from()', () => {
      const value = 42;
      expect(transformer.from(transformer.to(value))).toBe(value);
    });
  });
});
