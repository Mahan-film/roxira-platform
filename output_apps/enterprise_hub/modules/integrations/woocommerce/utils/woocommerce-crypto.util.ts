import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

const VERSION = 'v1';

function getMasterKey(customKey?: Buffer): Buffer {
  if (customKey && customKey.length === 32) {
    return customKey;
  }
  const envKey =
    process.env.WOOCOMMERCE_KEY_ENCRYPTION_KEY ||
    process.env.MOADIAN_KEY_ENCRYPTION_KEY ||
    process.env.APP_SECRET;
  if (!envKey || envKey.trim().length === 0) {
    throw new Error('WOOCOMMERCE_KEY_ENCRYPTION_KEY is not configured (fail closed)');
  }
  return createHash('sha256').update(envKey.trim()).digest();
}

export function sealSecret(plaintext: string, tenantId: string, customKey?: Buffer): string {
  const masterKey = getMasterKey(customKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function openSecret(sealed: string, tenantId: string, customKey?: Buffer): string {
  const masterKey = getMasterKey(customKey);
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported sealed secret format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  const prefix = key.startsWith('ck_') ? 'ck_...' : key.startsWith('cs_') ? 'cs_...' : '...';
  return `${prefix}${key.slice(-4)}`;
}

export function computeHmacSignature(payload: string | Buffer, secret: string): string {
  return createHmac('sha256', secret)
    .update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload)
    .digest('base64');
}

export function verifyHmacSignature(payload: string | Buffer, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    const computed = computeHmacSignature(payload, secret);
    const computedBuf = Buffer.from(computed, 'utf8');
    const sigBuf = Buffer.from(signature.trim(), 'utf8');
    if (computedBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(computedBuf, sigBuf);
  } catch {
    return false;
  }
}
