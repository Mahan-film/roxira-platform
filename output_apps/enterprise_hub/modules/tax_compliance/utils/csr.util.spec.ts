import { generateKeyPairSync } from 'crypto';
import { createCertificateRequest } from './csr.util';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const der = (pem: string): Buffer =>
  Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');

describe('createCertificateRequest', () => {
  const subject = { commonName: 'Test Co', organization: 'Test Org', country: 'IR' };

  it('returns a PEM CERTIFICATE REQUEST', () => {
    const pem = createCertificateRequest(subject, keys.publicKey, keys.privateKey);
    expect(pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----\n')).toBe(true);
    expect(pem.endsWith('-----END CERTIFICATE REQUEST-----\n')).toBe(true);
  });

  it('wraps base64 lines at 64 characters', () => {
    const pem = createCertificateRequest(subject, keys.publicKey, keys.privateKey);
    const body = pem.split('\n').slice(1, -2);
    expect(body.length).toBeGreaterThan(1);
    for (const line of body.slice(0, -1)) expect(line).toHaveLength(64);
  });

  it('is a DER SEQUENCE that carries the subject text', () => {
    const buf = der(createCertificateRequest(subject, keys.publicKey, keys.privateKey));
    expect(buf[0]).toBe(0x30);
    expect(buf.includes(Buffer.from('Test Co'))).toBe(true);
    expect(buf.includes(Buffer.from('Test Org'))).toBe(true);
  });

  it('is deterministic for the same inputs (RSA PKCS#1 v1.5)', () => {
    const a = createCertificateRequest(subject, keys.publicKey, keys.privateKey);
    const b = createCertificateRequest(subject, keys.publicKey, keys.privateKey);
    expect(a).toBe(b);
  });

  it('changes when the subject changes', () => {
    const a = createCertificateRequest(subject, keys.publicKey, keys.privateKey);
    const b = createCertificateRequest({ ...subject, commonName: 'Other Co' }, keys.publicKey, keys.privateKey);
    expect(a).not.toBe(b);
  });

  it('throws on an invalid public key', () => {
    expect(() => createCertificateRequest(subject, 'not a key', keys.privateKey)).toThrow();
  });

  it('accepts a minimal subject with only a common name', () => {
    expect(() => createCertificateRequest({ commonName: 'Only CN' }, keys.publicKey, keys.privateKey)).not.toThrow();
  });
});
