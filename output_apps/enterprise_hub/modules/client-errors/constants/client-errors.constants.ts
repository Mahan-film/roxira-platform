/** مسیر کنترلر دریافت خطاهای کلاینت (مرورگر). */
export const CLIENT_ERRORS_RESOURCE = 'enterprise-hub/client-errors';

/** محدودیت نرخ هر IP: ۲۰ گزارش در دقیقه (کلاینت خودش حداکثر ۵ گزارش در هر بارگذاری می‌فرستد). */
export const CLIENT_ERRORS_THROTTLE = { ttl: 60_000, limit: 20 } as const;

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_STACK_LENGTH = 4096;
export const MAX_PATH_LENGTH = 300;
export const MAX_USER_AGENT_LENGTH = 300;
export const MAX_BUILD_LENGTH = 64;

/** حداکثر یک هشدار برای هر پیام یکتا در این بازه. */
export const ALERT_DEDUPE_WINDOW_MS = 30 * 60_000;
/** سقف کلی هشدار در بازه (جلوگیری از سیل پیام‌های متفاوت). */
export const ALERT_GLOBAL_WINDOW_MS = 10 * 60_000;
export const ALERT_GLOBAL_MAX = 10;
/** سقف تعداد کلیدهای نگه‌داری‌شده در حافظه. */
export const ALERT_MAX_TRACKED = 500;

export const CLIENT_ERROR_KINDS = ['error', 'unhandledrejection', 'boundary'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];
