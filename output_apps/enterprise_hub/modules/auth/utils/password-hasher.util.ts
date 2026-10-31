import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import {
  SCRYPT_MAX_MEMORY_BYTES,
  SCRYPT_PARAMS,
} from '../constants/password-auth.constants';

/** scrypt with a promise API and an explicit memory ceiling. */
function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      keyLength,
      { N, r, p, maxmem: SCRYPT_MAX_MEMORY_BYTES },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/**
 * Hash a password with scrypt.
 * Format: `scrypt$N$r$p$<salt b64>$<hash b64>`; the parameters travel with the
 * hash so the cost can be raised later and old hashes still verify.
 */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keyLength, saltBytes } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt, keyLength, N, r, p);
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

/** Constant-time check of a password against a stored hash; false for any malformed hash. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const candidate = await derive(
      password,
      parsed.salt,
      parsed.key.length,
      parsed.N,
      parsed.r,
      parsed.p,
    );
    return timingSafeEqual(candidate, parsed.key);
  } catch {
    return false;
  }
}

/** True when the stored hash uses weaker parameters than the current ones. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return (
    parsed.N < SCRYPT_PARAMS.N ||
    parsed.r < SCRYPT_PARAMS.r ||
    parsed.p < SCRYPT_PARAMS.p
  );
}

/** A real hash of a random password, computed once, so unknown accounts cost the same time as known ones. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
