/**
 * ثابت‌های احراز هویت Passkey / WebAuthn (ماژول Auth).
 *
 * این پیاده‌سازی بر پایه Web Authentication API (W3C) است و برای لاگین
 * بیومتریک (Touch ID / Windows Hello) و کلید سخت‌افزاری (YubiKey و امثال آن)
 * به‌کار می‌رود. چالش هر مراسم در Redis با انقضای کوتاه نگهداری می‌شود تا
 * از حمله Replay جلوگیری گردد.
 */

/** شناسه دامنه وابسته (Relying Party ID) — پیش‌فرض دامنه بین‌المللی. */
export const WEBAUTHN_RP_ID_DEFAULT = 'roxira.net';

/** نام نمایشی Relying Party که در پیام‌های سیستمی نمایش داده می‌شود. */
export const WEBAUTHN_RP_NAME_DEFAULT = 'Roxira International';

/**
 * مبدأهای مجاز (با کاما جدا می‌شوند). در نبود مقدار، مبدأهای پیش‌فرض
 * دامنه بین‌المللی و localhost توسعه استفاده می‌شوند.
 */
export const WEBAUTHN_ORIGINS_DEFAULT =
  'https://roxira.net,https://www.roxira.net,http://localhost:3001,http://localhost:3000';

/** مدت اعتبار چالش WebAuthn بر حسب ثانیه (۹۰ ثانیه). */
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 90;

/** طول چالش تصادفی بر حسب بایت (۳۲ بایت = ۲۵۶ بیت). */
export const WEBAUTHN_CHALLENGE_BYTES = 32;

/** پیشوند کلید Redis برای چالش ثبت Passkey جدید. */
export const WEBAUTHN_REGISTRATION_CHALLENGE_PREFIX =
  'roxira:auth:webauthn:reg:';

/** پیشوند کلید Redis برای چالش احراز هویت با Passkey. */
export const WEBAUTHN_AUTHENTICATION_CHALLENGE_PREFIX =
  'roxira:auth:webauthn:auth:';

/** مهلت مراسم WebAuthn در میلی‌ثانیه (۶۰ ثانیه). */
export const WEBAUTHN_TIMEOUT_MS = 60000;

/** الگوریتم‌های امضای پشتیبانی‌شده: ES256 (COSE -7) و RS256 (COSE -257). */
export const WEBAUTHN_PUBLIC_KEY_ALGORITHMS = [-7, -257];

/** پرچم‌های authenticatorData. */
export const AUTHENTICATOR_FLAG_USER_PRESENT = 0x01;
export const AUTHENTICATOR_FLAG_USER_VERIFIED = 0x04;
export const AUTHENTICATOR_FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

/** مقدار کلید قرارداد در Redis برای شناسه چالش کاربر. */
export const WEBAUTHN_USER_ID_PREFIX = 'roxira:webauthn:user:';
