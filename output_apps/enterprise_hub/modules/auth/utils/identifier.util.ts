import {
  COMMON_PASSWORDS,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_REGEX,
} from '../constants/password-auth.constants';

/** Pragmatic address check: one @, a dotted domain, no spaces. Real proof is the reset email. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return value.length <= EMAIL_MAX_LENGTH && EMAIL_REGEX.test(value);
}

export function isUsername(value: string): boolean {
  return (
    value.length >= USERNAME_MIN_LENGTH &&
    value.length <= USERNAME_MAX_LENGTH &&
    USERNAME_REGEX.test(value)
  );
}

export type LoginIdentifier =
  | { kind: 'email'; value: string }
  | { kind: 'username'; value: string };

/** Classify a login field: anything with an @ is an email, the rest is a username. */
export function parseLoginIdentifier(raw: string): LoginIdentifier {
  const value = normalizeEmail(raw);
  return value.includes('@')
    ? { kind: 'email', value }
    : { kind: 'username', value };
}

/** Why a password is unacceptable, or null when it is fine. */
export function passwordPolicyViolation(
  password: string,
  identifiers: string[] = [],
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) {
    return 'This password is too easy to guess.';
  }
  const local = (value: string) => value.split('@')[0];
  if (
    identifiers.some((id) => id && (lower === id || lower === local(id)))
  ) {
    return 'Password must not match your username or email.';
  }
  return null;
}
