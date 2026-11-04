import { buildIban, isValidIban, normaliseAccountNumber, normaliseIban } from './iban';

describe('iban helpers', () => {
  const iban = buildIban('017', '123456789');

  it('buildIban makes a valid 26-char IR IBAN', () => {
    expect(iban).toMatch(/^IR\d{24}$/);
    expect(isValidIban(iban)).toBe(true);
  });

  it('isValidIban rejects a wrong check digit and a wrong shape', () => {
    const bad = `IR${iban[2] === '9' ? '0' : String(Number(iban[2]) + 1)}${iban.slice(3)}`;
    expect(isValidIban(bad)).toBe(false);
    expect(isValidIban('IR12')).toBe(false);
    expect(isValidIban('GB82WEST12345698765432')).toBe(false);
  });

  it('normaliseIban strips spaces and dashes, uppercases, converts Persian digits', () => {
    const spaced = `${iban.slice(0, 4)} ${iban.slice(4, 8)}-${iban.slice(8)}`.toLowerCase();
    expect(normaliseIban(spaced)).toBe(iban);
    const persian = iban.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    expect(normaliseIban(`IR${persian.slice(2)}`)).toBe(iban);
  });

  it('normaliseIban returns null for wrong shape or empty input', () => {
    expect(normaliseIban(null)).toBeNull();
    expect(normaliseIban('')).toBeNull();
    expect(normaliseIban('IR123')).toBeNull();
  });

  it('normaliseAccountNumber keeps digits only and drops leading zeros', () => {
    expect(normaliseAccountNumber('0102-33.4455')).toBe('1023344 55'.replace(' ', ''));
    expect(normaliseAccountNumber('۰۱۰۲۳۳')).toBe('10233');
    expect(normaliseAccountNumber(undefined)).toBe('');
  });
});
