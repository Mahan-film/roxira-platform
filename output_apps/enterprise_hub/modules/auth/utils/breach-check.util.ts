import { createHash } from 'crypto';

/**
 * Optional "has this password appeared in a known breach?" check using the
 * Pwned Passwords range API (k-anonymity: only the first 5 hex characters of the
 * SHA-1 leave the server, never the password). Off unless PASSWORD_BREACH_CHECK=1,
 * and it fails open (a network problem must not block sign-up).
 */
export async function isBreachedPassword(
  password: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (env.PASSWORD_BREACH_CHECK !== '1') return false;
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hash, count] = line.trim().split(':');
      return hash === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const BREACHED_PASSWORD_ERROR =
  'This password appears in known data breaches. Choose a different one.';
