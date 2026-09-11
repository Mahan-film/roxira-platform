import {
  KeyObject,
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  randomBytes,
  verify as cryptoVerify,
} from 'crypto';
import {
  AUTHENTICATOR_FLAG_ATTESTED_CREDENTIAL_DATA,
  AUTHENTICATOR_FLAG_USER_PRESENT,
  AUTHENTICATOR_FLAG_USER_VERIFIED,
} from '../constants/webauthn.constants';
import { decodeCbor } from './cbor.util';

/**
 * ابزارهای کمکی COSE / WebAuthn:
 * تبدیل کلید عمومی COSE به KeyObject، تجزیه authenticatorData و بررسی امضا.
 * تمام توابع خالص (Pure) و بدون وابستگی به فریم‌ورک هستند.
 */

/** کدگذاری Base64URL یک بافر. */
export function bufferToBase64Url(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** رمزگشایی Base64URL به بافر. */
export function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

/** ساخت چالش تصادفی امن (CSPRNG) به‌صورت Base64URL. */
export function generateChallenge(bytes: number): string {
  return bufferToBase64Url(randomBytes(bytes));
}

/** ساخت شناسه کاربر WebAuthn (Base64URL از UUID). */
export function generateUserHandle(userId: string): string {
  return bufferToBase64Url(Buffer.from(userId, 'utf8'));
}

/** خواندن مقدار از نقشهٔ COSE با کلید عددی. */
function mapGet(map: Map<unknown, unknown>, key: number): unknown {
  return map.get(key);
}

function asBytes(value: unknown): Buffer | null {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

/** نگاشت الگوریتم COSE به الگوریتم و پارامترهای امضای Node.js. */
function nodeVerifyParams(alg: number): {
  algorithm: string;
  padding?: number;
  saltLength?: number;
} {
  switch (alg) {
    case -7:
      return { algorithm: 'sha256' };
    case -35:
      return { algorithm: 'sha384' };
    case -36:
      return { algorithm: 'sha512' };
    case -257:
      return { algorithm: 'sha256' };
    case -258:
      return { algorithm: 'sha384' };
    case -259:
      return { algorithm: 'sha512' };
    case -37:
      return {
        algorithm: 'sha256',
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      };
    case -38:
      return {
        algorithm: 'sha384',
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: 48,
      };
    case -39:
      return {
        algorithm: 'sha512',
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: 64,
      };
    default:
      throw new Error(`الگوریتم COSE پشتیبانی نمی‌شود: ${alg}`);
  }
}

/**
 * تبدیل کلید عمومی COSE (بافر CBOR) به KeyObject قابل استفاده در Node.js.
 * از کدهای EC2 (P-256/384/521) و RSA پشتیبانی می‌کند.
 */
export function coseToPublicKey(
  coseBytes: Buffer,
  alg: number,
): KeyObject {
  const decoded = decodeCbor(new Uint8Array(coseBytes));
  if (!(decoded instanceof Map)) {
    throw new Error('کلید عمومی COSE نامعتبر است.');
  }

  const kty = mapGet(decoded, 1);
  const algorithm = mapGet(decoded, 3) ?? alg;

  if (kty === 2) {
    const crv = mapGet(decoded, -1);
    const x = asBytes(mapGet(decoded, -2));
    const y = asBytes(mapGet(decoded, -3));
    if (!x || !y) {
      throw new Error('مختصات کلید EC نامعتبر است.');
    }
    const crvName =
      crv === 1 ? 'P-256' : crv === 2 ? 'P-384' : crv === 3 ? 'P-521' : null;
    if (!crvName) {
      throw new Error(`منحنی EC پشتیبانی نمی‌شود: ${String(crv)}`);
    }
    return createPublicKey({
      key: {
        kty: 'EC',
        crv: crvName,
        x: bufferToBase64Url(x),
        y: bufferToBase64Url(y),
      },
      format: 'jwk',
    });
  }

  if (kty === 3) {
    const n = asBytes(mapGet(decoded, -1));
    const e = asBytes(mapGet(decoded, -2));
    if (!n || !e) {
      throw new Error('اجزای کلید RSA نامعتبر است.');
    }
    return createPublicKey({
      key: {
        kty: 'RSA',
        n: bufferToBase64Url(n),
        e: bufferToBase64Url(e),
      },
      format: 'jwk',
    });
  }

  throw new Error('نوع کلید COSE (kty) پشتیبانی نمی‌شود.');
}

/** نتیجه تجزیه authenticatorData. */
export interface ParsedAuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  hasAttestedCredentialData: boolean;
  signCount: number;
  credentialId: Buffer | null;
  credentialPublicKey: Buffer | null;
}

/** تجزیه ساختار authenticatorData طبق W3C WebAuthn. */
export function parseAuthenticatorData(
  authData: Buffer,
): ParsedAuthenticatorData {
  if (authData.length < 37) {
    throw new Error('authenticatorData کوتاه‌تر از حد مجاز است.');
  }

  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);

  const result: ParsedAuthenticatorData = {
    rpIdHash,
    flags,
    userPresent: (flags & AUTHENTICATOR_FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & AUTHENTICATOR_FLAG_USER_VERIFIED) !== 0,
    hasAttestedCredentialData:
      (flags & AUTHENTICATOR_FLAG_ATTESTED_CREDENTIAL_DATA) !== 0,
    signCount,
    credentialId: null,
    credentialPublicKey: null,
  };

  if (result.hasAttestedCredentialData) {
    if (authData.length < 55) {
      throw new Error('دادهٔ اعتبارنامه در authenticatorData ناقص است.');
    }
    const credentialIdLength = authData.readUInt16BE(53);
    const credentialIdStart = 55;
    const credentialIdEnd = credentialIdStart + credentialIdLength;
    if (authData.length < credentialIdEnd) {
      throw new Error('شناسه اعتبارنامه در authenticatorData ناقص است.');
    }
    result.credentialId = authData.subarray(credentialIdStart, credentialIdEnd);
    result.credentialPublicKey = authData.subarray(credentialIdEnd);
  }

  return result;
}

/**
 * بررسی امضای یک Assertion WebAuthn:
 *   signature = Sign(authenticatorData || SHA256(clientDataJSON))
 */
export function verifyAssertionSignature(params: {
  publicKey: KeyObject;
  alg: number;
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
  signature: Buffer;
}): boolean {
  const { publicKey, alg, authenticatorData, clientDataJSON, signature } =
    params;
  const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
  const signedData = Buffer.concat([authenticatorData, clientDataHash]);
  const { algorithm, padding, saltLength } = nodeVerifyParams(alg);

  return cryptoVerify(
    algorithm,
    signedData,
    padding
      ? {
          key: publicKey,
          padding,
          saltLength,
        }
      : publicKey,
    signature,
  );
}

/** محاسبه SHA-256 برای بررسی rpIdHash. */
export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}
