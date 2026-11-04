import { maskForLlm } from './mask';

describe('maskForLlm', () => {
  it('masks a card number, a phone number and a national id', () => {
    expect(maskForLlm('card 6037997412345678')).toContain('[CARD]');
    expect(maskForLlm('call 09123456789')).toContain('[PHONE]');
    expect(maskForLlm('id 0012345678')).toContain('[ID]');
  });

  it('masks any other long digit run', () => {
    expect(maskForLlm('ref 1234567')).toContain('[NUM]');
  });

  it('masks known names passed by the caller', () => {
    const out = maskForLlm('payment to Ali Rezaei for rent', ['Ali Rezaei']);
    expect(out).toContain('[NAME]');
    expect(out).not.toContain('rezaei');
  });

  it('keeps plain text, lowercased', () => {
    expect(maskForLlm('Monthly Rent')).toBe('monthly rent');
  });

  it('leaves no long digit run behind, even when masked twice', () => {
    const once = maskForLlm('card 6037997412345678 ref 1234567 id 0012345678');
    expect(once).not.toMatch(/\d{6,}/);
    expect(maskForLlm(once)).not.toMatch(/\d{6,}/);
  });

  it('caps the output at 300 characters', () => {
    expect(maskForLlm('a'.repeat(500)).length).toBe(300);
  });
});
