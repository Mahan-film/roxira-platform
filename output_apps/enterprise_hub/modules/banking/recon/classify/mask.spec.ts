import { maskForLlm } from './mask';

describe('maskForLlm', () => {
  it('should mask account numbers', () => {
    const result = maskForLlm('Account 1234567890');
    expect(result).toContain('[NUM]');
  });

  it('should mask card numbers', () => {
    const result = maskForLlm('Card 1234567890123456');
    expect(result).toContain('[CARD]');
  });

  it('should mask phone numbers', () => {
    const result = maskForLlm('Phone 09123456789');
    expect(result).toContain('[PHONE]');
  });

  it('should mask IBANs', () => {
    const result = maskForLlm('IBAN IR12345678901234567890123456');
    expect(result).toContain('[IBAN]');
  });

  it('should leave non-sensitive text intact', () => {
    const result = maskForLlm('This is a normal transaction');
    expect(result).toBe('This is a normal transaction');
  });

  it('should be idempotent', () => {
    const firstMask = maskForLlm('Account 1234567890');
    const secondMask = maskForLlm(firstMask);
    expect(secondMask).toBe(firstMask);
  });

  it('should handle empty string', () => {
    const result = maskForLlm('');
    expect(result).toBe('');
  });
});
