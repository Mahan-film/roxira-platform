import { createPublicKey, sign as cryptoSign } from 'crypto';

/**
 * ساخت درخواست امضای گواهی (PKCS#10 CSR) با کدگذاری DER و امضای
 * RSA-SHA256 — بدون هیچ وابستگی خارجی.
 *
 * Node.js به‌صورت بومی امکان تولید CSR را فراهم نمی‌کند؛ بنابراین این
 * ابزار حداقلی، ساختار استاندارد CertificationRequest را طبق RFC 2986
 * کدگذاری کرده و با کلید خصوصی سازمان امضا می‌کند تا درخواست برای مرجع
 * صدور گواهی (CA) سامانه مودیان قابل استفاده باشد.
 */

export interface CsrSubject {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  country?: string;
  state?: string;
  locality?: string;
  serialNumber?: string;
  emailAddress?: string;
}

// ---------------------------------------------------------------------------
// ابتدایی‌های کدگذاری DER
// ---------------------------------------------------------------------------

function encodeLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function derSequence(...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts));
}

function derSet(...parts: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(parts));
}

function derInteger(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);

  if ((bytes[0] & 0x80) !== 0) {
    bytes.unshift(0x00);
  }
  return tlv(0x02, Buffer.from(bytes));
}

function derNull(): Buffer {
  return tlv(0x05, Buffer.alloc(0));
}

function derBitString(content: Buffer): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([0x00]), content]));
}

function derUtf8String(value: string): Buffer {
  return tlv(0x0c, Buffer.from(value, 'utf8'));
}

function derPrintableString(value: string): Buffer {
  return tlv(0x13, Buffer.from(value, 'utf8'));
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map((part) => Number(part));
  const bytes: number[] = [40 * parts[0] + parts[1]];

  for (let index = 2; index < parts.length; index++) {
    let value = parts[index];
    const stack: number[] = [value & 0x7f];
    value = Math.floor(value / 128);
    while (value > 0) {
      stack.unshift((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    bytes.push(...stack);
  }

  return tlv(0x06, Buffer.from(bytes));
}

function derContext(tagNumber: number, content: Buffer): Buffer {
  return tlv(0xa0 | tagNumber, content);
}

// ---------------------------------------------------------------------------
// OIDهای موردنیاز (X.520 name attributes و RSA/SHA-256)
// ---------------------------------------------------------------------------

const OID = {
  sha256WithRsaEncryption: '1.2.840.113549.1.1.11',
  commonName: '2.5.4.3',
  countryName: '2.5.4.6',
  localityName: '2.5.4.7',
  stateOrProvinceName: '2.5.4.8',
  organizationName: '2.5.4.10',
  organizationalUnitName: '2.5.4.11',
  serialNumber: '2.5.4.5',
  emailAddress: '1.2.840.113549.1.9.1',
} as const;

function attribute(oid: string, value: string, printable = false): Buffer {
  const encodedValue = printable ? derPrintableString(value) : derUtf8String(value);
  return derSequence(derOid(oid), encodedValue);
}

function relativeDistinguishedName(oid: string, value: string, printable = false): Buffer {
  return derSet(attribute(oid, value, printable));
}

function buildSubject(subject: CsrSubject): Buffer {
  const rdns: Buffer[] = [];

  if (subject.country) {
    rdns.push(relativeDistinguishedName(OID.countryName, subject.country, true));
  }
  if (subject.state) {
    rdns.push(relativeDistinguishedName(OID.stateOrProvinceName, subject.state));
  }
  if (subject.locality) {
    rdns.push(relativeDistinguishedName(OID.localityName, subject.locality));
  }
  if (subject.organization) {
    rdns.push(relativeDistinguishedName(OID.organizationName, subject.organization));
  }
  if (subject.organizationalUnit) {
    rdns.push(
      relativeDistinguishedName(
        OID.organizationalUnitName,
        subject.organizationalUnit,
      ),
    );
  }
  rdns.push(relativeDistinguishedName(OID.commonName, subject.commonName));
  if (subject.serialNumber) {
    rdns.push(relativeDistinguishedName(OID.serialNumber, subject.serialNumber, true));
  }
  if (subject.emailAddress) {
    rdns.push(relativeDistinguishedName(OID.emailAddress, subject.emailAddress));
  }

  return derSequence(...rdns);
}

function toPem(der: Buffer, label: string): string {
  const base64 = der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

/**
 * تولید CSR در قالب PEM (PKCS#10) از کلید عمومی/خصوصی و موضوع گواهی.
 */
export function createCertificateRequest(
  subject: CsrSubject,
  publicKeyPem: string,
  privateKeyPem: string,
): string {
  const subjectPublicKeyInfo = createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  }) as Buffer;

  const certificationRequestInfo = derSequence(
    derInteger(0),
    buildSubject(subject),
    subjectPublicKeyInfo,
    derContext(0, Buffer.alloc(0)),
  );

  const signatureAlgorithm = derSequence(
    derOid(OID.sha256WithRsaEncryption),
    derNull(),
  );

  const signature = cryptoSign('sha256', certificationRequestInfo, privateKeyPem);

  const certificationRequest = derSequence(
    certificationRequestInfo,
    signatureAlgorithm,
    derBitString(signature),
  );

  return toPem(certificationRequest, 'CERTIFICATE REQUEST');
}
