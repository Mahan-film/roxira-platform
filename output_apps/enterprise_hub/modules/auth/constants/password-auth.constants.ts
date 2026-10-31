/**
 * Constants for username/email + password authentication, refresh tokens
 * and the password-reset flow (module Auth).
 */

/** scrypt cost (N = 2^15, r = 8, p = 1): ~64 MiB and ~80 ms on a server core. */
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64, saltBytes: 16 } as const;

/** scrypt needs 128 * N * r bytes; Node's default maxmem (32 MiB) is too small for N = 2^15. */
export const SCRYPT_MAX_MEMORY_BYTES = 128 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/** Lowercase letters, digits, dot, underscore and dash; must start and end with a letter or digit. */
export const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
export const EMAIL_MAX_LENGTH = 254;

/** Most-guessed passwords that still pass the length rule. Not a full breach list. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password12',
  'password123',
  'password1234',
  '1234567890',
  '12345678910',
  '0123456789',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou12',
  'admin12345',
  'welcome123',
  'letmein1234',
  'roxira12345',
  'roxira1234',
  'abcd123456',
  '1q2w3e4r5t',
  '0987654321',
  '1111111111',
  '0000000000',
  '09121234567',
]);

/** Access tokens are short; the refresh token keeps the user signed in. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_TOKEN_BYTES = 48;

/** Redis key prefixes. */
export const LOGIN_FAIL_REDIS_PREFIX = 'roxira:auth:pw-fail:';
export const SIGNUP_LIMIT_REDIS_PREFIX = 'roxira:auth:signup:';
export const FORGOT_LIMIT_REDIS_PREFIX = 'roxira:auth:forgot:';
export const RESET_TOKEN_REDIS_PREFIX = 'roxira:auth:pwreset:';

/** Failed logins per (identifier, ip) and per identifier alone, in the same window. */
export const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60;
export const LOGIN_FAIL_LIMIT_PER_IDENTIFIER_IP = 5;
export const LOGIN_FAIL_LIMIT_PER_IDENTIFIER = 20;

/** Signups per IP per hour. */
export const SIGNUP_LIMIT_PER_IP = { limit: 10, windowSeconds: 3600 } as const;

/** Reset emails per identifier and per IP per hour; excess requests are silently dropped. */
export const FORGOT_LIMIT_PER_IDENTIFIER = { limit: 3, windowSeconds: 3600 } as const;
export const FORGOT_LIMIT_PER_IP = { limit: 10, windowSeconds: 3600 } as const;

export const RESET_TOKEN_TTL_SECONDS = 30 * 60;
export const RESET_TOKEN_BYTES = 32;

/** One message for every failed login, whatever the cause (no account enumeration). */
export const LOGIN_GENERIC_ERROR = 'Invalid username/email or password.';
export const LOGIN_RATE_LIMIT_ERROR = 'Too many attempts. Try again later.';
export const SIGNUP_UNAVAILABLE_ERROR =
  'Could not create the account with these details. Try a different username or email, or sign in.';
export const FORGOT_GENERIC_RESPONSE =
  'If an account with a recovery email exists, a reset link has been sent.';
export const RESET_INVALID_ERROR = 'This reset link is invalid or has expired.';
export const REFRESH_INVALID_ERROR = 'Session expired. Please sign in again.';
export const SMS_DELIVERY_FAILED_ERROR =
  'We could not send the SMS code. Sign in with your password, or try again in a few minutes.';

export type UiLocale = 'fa' | 'en';
