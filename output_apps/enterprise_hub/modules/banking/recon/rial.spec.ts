import { parseRial, ledgerToMinor, rialToMinor, minorToRial, absBig, rialString, sanitizeText } from './rial';

describe('rial.ts', () => {
  describe('parseRial', () => {
    it('should parse standard rial format', () => {
      expect(parseRial('1,250,000')).toEqual({ kind: 'ok', value: 1250000n });
    });

    it('should parse Persian digits and separators', () => {
      expect(parseRial('۱٬۲۵۰٬۰۰۰')).toEqual({ kind: 'ok', value: 1250000n });
    });

    it('should handle negative values', () => {
      expect(parseRial('-500')).toEqual({ kind: 'ok', value: -500n });
      expect(parseRial('500-')).toEqual({ kind: 'ok', value: -500n });
      expect(parseRial('(500)')).toEqual({ kind: 'ok', value: -500n });
    });

    it('should handle empty and invalid inputs', () => {
      expect(parseRial('')).toEqual({ kind: 'empty' });
      expect(parseRial(null)).toEqual({ kind: 'empty' });
      expect(parseRial(undefined)).toEqual({ kind: 'empty' });
      expect(parseRial('garbage')).toEqual({ kind: 'invalid' });
    });
  });

  describe('ledgerToMinor', () => {
    it('should convert ledger amounts to minor units', () => {
      expect(ledgerToMinor(1250.50)).toBe(125050n);
      expect(ledgerToMinor('1250.50')).toBe(125050n);
      expect(ledgerToMinor(null)).toBe(0n);
      expect(ledgerToMinor(undefined)).toBe(0n);
    });
  });

  describe('rialToMinor', () => {
    it('should convert rial to minor units', () => {
      expect(rialToMinor(1250n)).toBe(125000n);
    });
  });

  describe('minorToRial', () => {
    it('should convert minor units to rial', () => {
      expect(minorToRial(125050n)).toBe(1250n);
    });
  });

  describe('absBig', () => {
    it('should return absolute value of bigint', () => {
      expect(absBig(-1250n)).toBe(1250n);
      expect(absBig(1250n)).toBe(1250n);
    });
  });

  describe('rialString', () => {
    it('should convert bigint to string', () => {
      expect(rialString(1250000n)).toBe('1250000');
      expect(rialString(null)).toBeNull();
    });
  });

  describe('sanitizeText', () => {
    it('should truncate long text', () => {
      const longText = 'a'.repeat(600);
      expect(sanitizeText(longText).length).toBe(500);
    });
  });
});
