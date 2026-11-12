import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import * as net from 'net';

const PRIVATE_BLOCKLIST = new net.BlockList();
PRIVATE_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('192.0.0.0', 24, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('224.0.0.0', 4, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('240.0.0.0', 4, 'ipv4');

PRIVATE_BLOCKLIST.addSubnet('::1', 128, 'ipv6');
PRIVATE_BLOCKLIST.addSubnet('::', 128, 'ipv6');
PRIVATE_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_BLOCKLIST.addSubnet('ff00::', 8, 'ipv6');

export { PRIVATE_BLOCKLIST };

export function isPrivateOrLoopbackHost(host: string): boolean {
  const cleanHost = host.replace(/^\[|\]$/g, '').toLowerCase();
  const ipType = net.isIP(cleanHost);
  if (ipType !== 0) {
    return PRIVATE_BLOCKLIST.check(cleanHost, ipType === 4 ? 'ipv4' : 'ipv6');
  }
  return (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.internal') ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.lan') ||
    cleanHost.endsWith('.home.arpa')
  );
}

const VERSION = 'v1';

function getMasterKey(customKey?: Buffer): Buffer {
  if (customKey && customKey.length === 32) {
    return customKey;
  }
  const envKey = process.env.WOOCOMMERCE_KEY_ENCRYPTION_KEY;
  if (!envKey || envKey.trim().length === 0) {
    throw new Error('WOOCOMMERCE_KEY_ENCRYPTION_KEY is not configured (fail closed)');
  }
  return createHash('sha256').update(envKey.trim()).digest();
}

export function assertSafeStoreUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid WooCommerce storeUrl');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('WooCommerce storeUrl must use https');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error('WooCommerce storeUrl cannot point to a private or loopback address');
  }
  return parsed;
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
