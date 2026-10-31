import { randomBytes } from 'crypto';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hotp, verifyTotp } from './totp.util';

describe('totp.util', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", 8-digit vectors truncated to 6.
  const secret = Buffer.from('12345678901234567890');

  it('matches the RFC 6238 test vectors', () => {
    expect(hotp(secret, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(secret, Math.floor(20000000000 / 30))).toBe('353130');
  });

  it('round-trips base32', () => {
    const raw = randomBytes(20);
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  it('accepts +-1 step of drift and rejects anything else', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(secret, hotp(secret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, hotp(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(secret, step + 2), now, null)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });

  it('never accepts a step twice (replay protection)', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(secret, hotp(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, hotp(secret, step - 1), now, step)).toBeNull();
  });

  it('encrypts secrets with AES-GCM: round-trip, random IV, tamper detection, wrong key', () => {
    const key = randomBytes(32);
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(a, randomBytes(32))).toThrow();
    const tampered = Buffer.from(a, 'base64');
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptSecret(tampered.toString('base64'), key)).toThrow();
  });
});
