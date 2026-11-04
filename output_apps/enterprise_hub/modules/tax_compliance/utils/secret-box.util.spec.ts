import { parseMasterKey, sealSecret, openSecret } from './secret-box.util';import { randomBytes } from 'crypto';describe('secret-box.util', () => {
  const testKey = randomBytes(32);
  const tenantId = 'test-tenant';

  it('should encrypt and decrypt the same text successfully', () => {
    const plaintext = 'test secret';
    const sealed = sealSecret(plaintext, testKey, tenantId);
    const opened = openSecret(sealed, testKey, tenantId);
    expect(opened).toBe(plaintext);
  });

  it('should produce different ciphertexts for the same plaintext', () => {
    const plaintext = 'test secret';
    const sealed1 = sealSecret(plaintext, testKey, tenantId);
    const sealed2 = sealSecret(plaintext, testKey, tenantId);
    expect(sealed1).not.toBe(sealed2);
  });

  it('should throw when decrypting tampered ciphertext', () => {
    const plaintext = 'test secret';
    const sealed = sealSecret(plaintext, testKey, tenantId);
    const tampered = sealed.replace('.', 'x');
    expect(() => openSecret(tampered, testKey, tenantId)).toThrow();
  });

  it('should throw when decrypting with wrong key', () => {
    const plaintext = 'test secret';
    const sealed = sealSecret(plaintext, testKey, tenantId);
    const wrongKey = randomBytes(32);
    expect(() => openSecret(sealed, wrongKey, tenantId)).toThrow();
  });

  it('should throw when decrypting with wrong tenant ID', () => {
    const plaintext = 'test secret';
    const sealed = sealSecret(plaintext, testKey, tenantId);
    const wrongTenantId = 'wrong-tenant';
    expect(() => openSecret(sealed, testKey, wrongTenantId)).toThrow();
  });

  it('should throw when parsing invalid master key', () => {
    expect(() => parseMasterKey('')).toThrow();
    expect(() => parseMasterKey('invalid')).toThrow();
    expect(() => parseMasterKey('a'.repeat(32))).toThrow();
  });
});