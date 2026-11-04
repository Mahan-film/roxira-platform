import { createCertificateRequest, CsrSubject } from './csr.util';
import { generateKeyPairSync } from 'crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const validSubject: CsrSubject = {
  commonName: 'Test Organization',
  organization: 'Test Org',
  organizationalUnit: 'Test Unit',
  country: 'IR',
  state: 'Tehran',
  locality: 'Tehran',
  serialNumber: '123456789',
  emailAddress: 'test@example.com',
};

const minimalSubject: CsrSubject = {
  commonName: 'Minimal Test',
};

const invalidSubjects = [
  { ...validSubject, commonName: '' },
  { ...validSubject, organization: '' },
  { ...validSubject, organizationalUnit: '' },
  { ...validSubject, country: '' },
  { ...validSubject, state: '' },
  { ...validSubject, locality: '' },
  { ...validSubject, serialNumber: '' },
  { ...validSubject, emailAddress: '' },
];

describe('createCertificateRequest', () => {
  it('should generate a valid PEM CSR with all subject fields', () => {
    const csr = createCertificateRequest(validSubject, publicKey, privateKey);
    expect(csr).toMatch(/-----BEGIN CERTIFICATE REQUEST-----/);
    expect(csr).toMatch(/-----END CERTIFICATE REQUEST-----/);
    expect(csr).toContain('Test Organization');
    expect(csr).toContain('Test Org');
    expect(csr).toContain('Test Unit');
    expect(csr).toContain('IR');
    expect(csr).toContain('Tehran');
    expect(csr).toContain('123456789');
    expect(csr).toContain('test@example.com');
  });

  it('should generate a valid PEM CSR with minimal subject fields', () => {
    const csr = createCertificateRequest(minimalSubject, publicKey, privateKey);
    expect(csr).toMatch(/-----BEGIN CERTIFICATE REQUEST-----/);
    expect(csr).toMatch(/-----END CERTIFICATE REQUEST-----/);
    expect(csr).toContain('Minimal Test');
  });

  it('should reject empty commonName', () => {
    expect(() => createCertificateRequest(invalidSubjects[0], publicKey, privateKey)).toThrow();
  });

  it('should reject empty organization', () => {
    expect(() => createCertificateRequest(invalidSubjects[1], publicKey, privateKey)).toThrow();
  });

  it('should reject empty organizationalUnit', () => {
    expect(() => createCertificateRequest(invalidSubjects[2], publicKey, privateKey)).toThrow();
  });

  it('should reject empty country', () => {
    expect(() => createCertificateRequest(invalidSubjects[3], publicKey, privateKey)).toThrow();
  });

  it('should reject empty state', () => {
    expect(() => createCertificateRequest(invalidSubjects[4], publicKey, privateKey)).toThrow();
  });

  it('should reject empty locality', () => {
    expect(() => createCertificateRequest(invalidSubjects[5], publicKey, privateKey)).toThrow();
  });

  it('should reject empty serialNumber', () => {
    expect(() => createCertificateRequest(invalidSubjects[6], publicKey, privateKey)).toThrow();
  });

  it('should reject empty emailAddress', () => {
    expect(() => createCertificateRequest(invalidSubjects[7], publicKey, privateKey)).toThrow();
  });

  it('should produce deterministic output for the same input', () => {
    const csr1 = createCertificateRequest(validSubject, publicKey, privateKey);
    const csr2 = createCertificateRequest(validSubject, publicKey, privateKey);
    expect(csr1).toEqual(csr2);
  });
});