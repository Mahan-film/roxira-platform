import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { base64UrlDecode, base64UrlEncode } from './moadian-jose.util';

/**
 * رمزنگاری در حالت سکون (at-rest) برای کلید خصوصی مودیان هر مستأجر.
 *
 * AES-256-GCM با کلید اصلی ۳۲ بایتی از محیط (`MOADIAN_KEY_ENCRYPTION_KEY`،
 * base64). `tenantId` به‌عنوان AAD بسته می‌شود؛ پس متن رمزشده‌ای که به ردیف
 * مستأجر دیگری کپی شود رمزگشایی نمی‌شود.
 *
 * قالب: `v1.<iv>.<tag>.<ciphertext>` (هر بخش base64url).
 */

const VERSION = 'v1';

export function parseMasterKey(base64Key: string | undefined): Buffer {
  if (!base64Key || base64Key.trim().length === 0) {
    throw new Error('MOADIAN_KEY_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(base64Key.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error('MOADIAN_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function sealSecret(plaintext: string, masterKey: Buffer, tenantId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    base64UrlEncode(iv),
    base64UrlEncode(cipher.getAuthTag()),
    base64UrlEncode(ciphertext),
  ].join('.');
}

export function openSecret(sealed: string, masterKey: Buffer, tenantId: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported sealed secret format');
  }
  const [, iv, tag, ct] = parts;
  const decipher = createDecipheriv('aes-256-gcm', masterKey, base64UrlDecode(iv));
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(base64UrlDecode(tag));
  return Buffer.concat([decipher.update(base64UrlDecode(ct)), decipher.final()]).toString(
    'utf8',
  );
}

export function isSealedSecret(value: string): boolean {
  return value.startsWith(`${VERSION}.`);
}

/**
 * Unseals a stored private key (`v1.<iv>.<tag>.<ciphertext>`).
 * When `allowLegacyPlaintextPem` is true, pre-existing unencrypted PEM rows remain readable
 * while newly generated keys are always sealed via `sealSecret`.
 */
export function openStoredPrivateKey(
  stored: string,
  masterKey: Buffer,
  tenantId: string,
  allowLegacyPlaintextPem = false,
): string {
  if (isSealedSecret(stored)) {
    return openSecret(stored, masterKey, tenantId);
  }
  if (allowLegacyPlaintextPem && stored.trimStart().startsWith('-----BEGIN ')) {
    return stored;
  }
  throw new Error('Unsupported or unsealed private key format');
}
