/**
 * ثابت‌های ماژول احراز هویت پیامکی (Auth & Kavenegar OTP).
 */

/** الگوی رسمی شماره همراه ایران: دقیقاً ۱۱ رقم و شروع با 09. */
export const IR_MOBILE_REGEX = /^09\d{9}$/;

/** طول کد یک‌بارمصرف امن (۶ رقمی؛ issue #366). */
export const OTP_CODE_LENGTH = 6;

/** مدت اعتبار کد یک‌بارمصرف در ثانیه (طبق الزام: ۱۲۰ ثانیه). */
export const OTP_TTL_SECONDS = 120;

/** پیشوند کلید Redis برای ذخیره کد یک‌بارمصرف. */
export const OTP_REDIS_PREFIX = 'roxira:auth:otp:';

/** پیشوند کلید Redis شمارنده تلاش‌های تأیید هر کد. */
export const OTP_ATTEMPTS_REDIS_PREFIX = 'roxira:auth:otp-att:';

/** پیشوند کلیدهای Redis محدودیت ارسال کد (به‌ازای شماره و IP). */
export const OTP_SEND_LIMIT_REDIS_PREFIX = 'roxira:auth:otp-send:';

/** حداکثر تلاش ناموفق برای هر کد پیش از ابطال آن (ضد Brute-Force). */
export const OTP_MAX_ATTEMPTS = 5;

/** محدودیت ارسال کد برای هر شماره همراه: ۳ ارسال *موفق* در ۱۰ دقیقه (تلاش‌های ناموفق/مسدود شمرده نمی‌شوند). */
export const OTP_SEND_LIMIT_PER_PHONE = { limit: 3, windowSeconds: 600 } as const;

/** حداقل فاصله بین دو ارسال کد برای یک شماره (ثانیه)؛ ارسال ناموفق این فاصله را مصرف نمی‌کند. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** محدودیت ارسال کد برای هر IP مبدأ: ۱۰ بار در ساعت. */
export const OTP_SEND_LIMIT_PER_IP = { limit: 10, windowSeconds: 3600 } as const;

/** پیام خطای یکسان برای همه شکست‌های تأیید (بدون سرنخ درباره علت). */
export const OTP_GENERIC_ERROR =
  'کد تأیید نامعتبر یا منقضی است؛ لطفاً دوباره تلاش کنید یا کد جدید بگیرید.';

/** پیام خطای یکسان برای عبور از محدودیت ارسال کد. */
export const OTP_SEND_LIMIT_ERROR =
  'تعداد درخواست کد بیش از حد مجاز است؛ لطفاً بعداً دوباره تلاش کنید.';

/** توکن دسترسی JWT — پیش‌فرض ۱ روز اعتبار (Refresh ندارد؛ پس از انقضا ورود مجدد). */
export const JWT_DEFAULT_EXPIRES_IN = '1d';

/** اعتبار پیش‌فرض توکن دسترسی بر حسب ثانیه (۱ روز) — برای بازگرداندن به کلاینت. */
export const JWT_DEFAULT_EXPIRES_IN_SECONDS = 86400;

/** محدودیت سخت‌گیرانه مسیرهای ورود (@Throttle): ۵ درخواست در دقیقه برای هر IP. */
export const AUTH_THROTTLE = { ttl: 60_000, limit: 5 } as const;

/** قالب پیش‌فرض کاوه‌نگار برای دامنه قاضی هوشمند. */
export const KAVENEGAR_TEMPLATE_GHAZI_DEFAULT = 'ghazi-verify';

/** قالب پیش‌فرض کاوه‌نگار برای دامنه روکسیرا. */
export const KAVENEGAR_TEMPLATE_ROXIRA_DEFAULT = 'roxira-verify';

/** آدرس پایه API کاوه‌نگار (Verify Lookup). */
export const KAVENEGAR_BASE_URL = 'https://api.kavenegar.com/v1';

/** توکن تزریق وابستگی کلاینت Redis اختصاصی ماژول Auth. */
export const REDIS_CLIENT = 'ROXIRA_AUTH_REDIS_CLIENT';
