import { sign as cryptoSign, verify as cryptoVerify } from 'crypto';

/**
 * امضای دیجیتال JWS (JSON Web Signature) در قالب Compact — بدون وابستگی
 * خارجی و صرفاً بر پایه ماژول بومی `crypto` در Node.js.
 *
 * الگوریتم پیش‌فرض `RS256` است: امضای RSA با SHA-256 روی رشته
 * `base64url(header).base64url(payload)` که دقیقاً منطبق بر RFC 7515 می‌باشد.
 */

export interface JwsProtectedHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

export interface SignedJwsResult {
  /** توکن کامل JWS در قالب Compact (`header.payload.signature`) */
  token: string;
  protectedHeader: JwsProtectedHeader;
  payload: Record<string, unknown>;
  /** امضای Base64Url بدون padding */
  signature: string;
  /** ورودی امضاشده (header.payload) */
  signingInput: string;
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

/**
 * امضای یک payload با کلید خصوصی RSA و تولید توکن JWS.
 */
export function signJws(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  protectedHeader: JwsProtectedHeader,
): SignedJwsResult {
  const header: JwsProtectedHeader = {
    alg: protectedHeader.alg,
    typ: protectedHeader.typ ?? 'JOSE',
    ...(protectedHeader.kid ? { kid: protectedHeader.kid } : {}),
  };

  const encodedHeader = base64Url(Buffer.from(JSON.stringify(header), 'utf8'));
  const encodedPayload = base64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), privateKeyPem);
  const encodedSignature = base64Url(signature);

  return {
    token: `${signingInput}.${encodedSignature}`,
    protectedHeader: header,
    payload,
    signature: encodedSignature,
    signingInput,
  };
}

/**
 * راستی‌آزمایی امضای یک توکن JWS با کلید عمومی RSA.
 */
export function verifyJws(token: string, publicKeyPem: string): boolean {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return false;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  try {
    return cryptoVerify(
      'sha256',
      Buffer.from(signingInput, 'utf8'),
      publicKeyPem,
      fromBase64Url(encodedSignature),
    );
  } catch {
    return false;
  }
}
