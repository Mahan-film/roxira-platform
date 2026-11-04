import { normaliseIban, isValidIban, normaliseAccountNumber, buildIban } from './iban';

describe('IBAN helpers', () => {
  describe('normaliseIban', () => {
    it('should remove spaces and lowercase letters', () => {
      expect(normaliseIban('IR 1234 5678 9012 3456 7890 12')).toBe('IR1234567890123456789012');
    });

    it('should convert Persian digits to ASCII', () => {
      expect(normaliseIban('IR۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹۰۱۲')).toBe('IR1234567890123456789012');
    });

    it('should add IR prefix if missing', () => {
      expect(normaliseIban('1234567890123456789012')).toBe('IR1234567890123456789012');
    });

    it('should return null for invalid IBANs', () => {
      expect(normaliseIban('IR123456789012345678901')).toBeNull();
      expect(normaliseIban('')).toBeNull();
      expect(normaliseIban(null)).toBeNull();
      expect(normaliseIban(undefined)).toBeNull();
    });
  });

  describe('isValidIban', () => {
    it('should validate correct IBANs', () => {
      expect(isValidIban('IR180000000000123456789012')).toBe(true);
    });

    it('should reject invalid IBANs', () => {
      expect(isValidIban('IR180000000000123456789013')).toBe(false);
      expect(isValidIban('IR18000000000012345678901')).toBe(false);
      expect(isValidIban('')).toBe(false);
      expect(isValidIban(null)).toBe(false);
      expect(isValidIban(undefined)).toBe(false);
    });
  });

  describe('normaliseAccountNumber', () => {
    it('should convert Persian digits and remove non-digits', () => {
      expect(normaliseAccountNumber('۰۱۰۲-۳۳.۴۴۵۵')).toBe('102334455');
    });

    it('should handle empty input', () => {
      expect(normaliseAccountNumber('')).toBe('');
      expect(normaliseAccountNumber(null)).toBe('');
      expect(normaliseAccountNumber(undefined)).toBe('');
    });
  });

  describe('buildIban', () => {
    it('should build valid IBANs', () => {
      const iban = buildIban('057', '0000000000000000001');
      expect(isValidIban(iban)).toBe(true);
    });

    it('should round-trip with isValidIban', () => {
      const bankId = '057';
      const body19 = '0000000000000000001';
      const iban = buildIban(bankId, body19);
      expect(isValidIban(iban)).toBe(true);
      expect(iban.startsWith('IR')).toBe(true);
      expect(iban.length).toBe(26);
    });
  });
});
