import {
  KeyObject,
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';

/**
 * JOSE مخصوص سامانه مودیان (API v2، requestsmanager) — فقط ماژول بومی `crypto`.
 *
 * - JWS (RFC 7515) Compact با RS256 و هدر
 *   `{alg:'RS256', typ:'jose', x5c:[cert], sigT, crit:['sigT'], cty:'text/plain'}`
 *   هم برای توکن احراز هویت ({nonce, clientId}) و هم برای بستهٔ صورتحساب.
 * - JWE (RFC 7516) Compact با `alg: RSA-OAEP-256` و `enc: A256GCM` و `kid` کلید
 *   عمومی سازمان امور مالیاتی (از /server-information).
 *
 * منبع و میزان اطمینان: docs/research/MOADIAN_REQUIREMENTS_2026-10-14.md §8.
 */

export interface MoadianJwsHeader {
  alg: 'RS256';
  typ: 'jose';
  x5c: string[];
  sigT: string;
  crit: ['sigT'];
  cty: 'text/plain';
}

export interface MoadianJweHeader {
  alg: 'RSA-OAEP-256';
  enc: 'A256GCM';
  kid: string;
}

export function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

/** گواهی PEM → رشتهٔ base64 بدون سرآیند (مقدار x5c). */
export function certificatePemToX5c(certificatePem: string): string {
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

/** کلید عمومی سازمان (base64 خام SPKI یا PEM) → KeyObject. */
export function toPublicKeyObject(key: string): KeyObject {
  const trimmed = key.trim();
  const pem = trimmed.startsWith('-----BEGIN')
    ? trimmed
    : `-----BEGIN PUBLIC KEY-----\n${trimmed.replace(/\s+/g, '')}\n-----END PUBLIC KEY-----`;
  return createPublicKey(pem);
}

/** sigT: زمان امضا به‌شکل ISO بدون میلی‌ثانیه (`2026-10-22T10:00:00Z`). */
export function formatSigT(now: Date): string {
  return `${now.toISOString().split('.')[0]}Z`;
}

/** امضای payload (JSON) در قالب JWS Compact با هدر مودیان. */
export function signMoadianJws(
  payload: unknown,
  privateKeyPem: string,
  certificatePem: string,
  now: Date = new Date(),
): string {
  const header: MoadianJwsHeader = {
    alg: 'RS256',
    typ: 'jose',
    x5c: [certificatePemToX5c(certificatePem)],
    sigT: formatSigT(now),
    crit: ['sigT'],
    cty: 'text/plain',
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}`;
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), privateKeyPem);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/** راستی‌آزمایی JWS و بازگرداندن هدر/payload؛ در صورت نامعتبر بودن null. */
export function verifyMoadianJws(
  token: string,
  publicKey: string | KeyObject,
): { header: MoadianJwsHeader; payload: unknown } | null {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }
  const [h, p, s] = segments;
  try {
    const ok = cryptoVerify(
      'sha256',
      Buffer.from(`${h}.${p}`, 'utf8'),
      publicKey,
      base64UrlDecode(s),
    );
    if (!ok) {
      return null;
    }
    return {
      header: JSON.parse(base64UrlDecode(h).toString('utf8')) as MoadianJwsHeader,
      payload: JSON.parse(base64UrlDecode(p).toString('utf8')) as unknown,
    };
  } catch {
    return null;
  }
}

/**
 * رمزنگاری JWE Compact (RSA-OAEP-256 + A256GCM).
 * AAD طبق RFC 7516 §5.1 همان ASCII(BASE64URL(protected header)) است.
 */
export function encryptMoadianJwe(
  plaintext: string,
  taxOrgPublicKey: string | KeyObject,
  taxOrgKeyId: string,
): string {
  const key =
    typeof taxOrgPublicKey === 'string' ? toPublicKeyObject(taxOrgPublicKey) : taxOrgPublicKey;
  const header: MoadianJweHeader = { alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: taxOrgKeyId };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const cek = randomBytes(32);
  const iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    { key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    cek,
  );
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(encodedHeader, 'ascii'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    encodedHeader,
    base64UrlEncode(encryptedKey),
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(tag),
  ].join('.');
}

/** رمزگشایی JWE Compact — فقط برای آزمون رفت‌وبرگشت (سمت ما هرگز کلید خصوصی سازمان را ندارد). */
export function decryptMoadianJwe(
  jwe: string,
  privateKeyPem: string,
): { header: MoadianJweHeader; plaintext: string } {
  const parts = jwe.split('.');
  if (parts.length !== 5) {
    throw new Error('JWE compact serialization must have 5 parts');
  }
  const [h, k, iv, ct, tag] = parts;
  const header = JSON.parse(base64UrlDecode(h).toString('utf8')) as MoadianJweHeader;
  if (header.alg !== 'RSA-OAEP-256' || header.enc !== 'A256GCM') {
    throw new Error('Unsupported JWE algorithm');
  }
  const cek = privateDecrypt(
    {
      key: privateKeyPem,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    base64UrlDecode(k),
  );
  const decipher = createDecipheriv('aes-256-gcm', cek, base64UrlDecode(iv));
  decipher.setAAD(Buffer.from(h, 'ascii'));
  decipher.setAuthTag(base64UrlDecode(tag));
  const plaintext = Buffer.concat([
    decipher.update(base64UrlDecode(ct)),
    decipher.final(),
  ]).toString('utf8');
  return { header, plaintext };
}
