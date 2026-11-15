import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

const VERSION = 'v1';

function getMasterKey(): Buffer {
  const envKey = process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY;
  if (!envKey || envKey.trim().length === 0) {
    throw new Error('PAYMENT_GATEWAY_ENCRYPTION_KEY is not configured (fail closed)');
  }
  const trimmed = envKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/=]{44}$/.test(trimmed)) {
    const b64 = Buffer.from(trimmed, 'base64');
    if (b64.length === 32) return b64;
  }
  const salt = process.env.PAYMENT_GATEWAY_ENCRYPTION_SALT || 'roxira-payment-gateway-kdf-salt';
  return pbkdf2Sync(trimmed, salt, 100_000, 32, 'sha256');
}

/**
 * Seals merchant credentials at rest via AES-256-GCM using version and tenant ID as Authenticated Additional Data (AAD).
 */
export function sealMerchantId(plaintext: string, tenantId: string): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${tenantId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Opens and verifies sealed merchant credentials using version and tenant ID as AAD.
 */
export function openMerchantId(sealed: string, tenantId: string): string {
  const masterKey = getMasterKey();
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported sealed merchant secret format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(Buffer.from(`${VERSION}:${tenantId}`, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Masks merchant ID to prevent credential leakage in API responses.
 * Never returns the plain merchant key.
 */
export function maskMerchantId(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 6) return '****';
  return `****${trimmed.slice(-4)}`;
}
