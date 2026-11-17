import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const ERASED_PARTY_NAME = '[ERASED]';

export interface PartyPiiPayload {
  name: string;
  nationalId: string | null;
  economicCode: string | null;
  phone: string | null;
  email: string | null;
}

/** Generate a fresh 256-bit AES-GCM data encryption key (base64-encoded) for one party. */
export function generatePartyDek(): string {
  return randomBytes(32).toString('base64');
}

/** Encrypt party personal data with the party's per-party DEK (`v1:<iv>:<tag>:<ct>`). */
export function encryptPartyPii(dekB64: string, payload: PartyPiiPayload): string {
  const key = Buffer.from(dekB64, 'base64');
  if (key.length !== 32) {
    throw new Error('Party DEK must be 32 bytes');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt party personal data with the party's per-party DEK. Returns `null` when the key is
 * missing, destroyed (crypto-shredded), or tampered with.
 */
export function decryptPartyPii(dekB64: string | null | undefined, ciphertext: string | null | undefined): PartyPiiPayload | null {
  if (!dekB64 || !ciphertext) return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const key = Buffer.from(dekB64, 'base64');
    if (key.length !== 32) return null;
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as PartyPiiPayload;
  } catch {
    return null;
  }
}
