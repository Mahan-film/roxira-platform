/**
 * ثابت‌های ماژول احراز هویت پیامکی (Auth & Kavenegar OTP).
 */

/** الگوی رسمی شماره همراه ایران: دقیقاً ۱۱ رقم و شروع با 09. */
export const IR_MOBILE_REGEX = /^09\d{9}$/;

/** طول کد یک‌بارمصرف امن (۵ رقمی طبق الزامات سرویس). */
export const OTP_CODE_LENGTH = 5;

/** مدت اعتبار کد یک‌بارمصرف در ثانیه (طبق الزام: ۱۲۰ ثانیه). */
export const OTP_TTL_SECONDS = 120;

/** پیشوند کلید Redis برای ذخیره کد یک‌بارمصرف. */
export const OTP_REDIS_PREFIX = 'roxira:auth:otp:';

/** حداکثر تلاش ناموفق برای هر کد پیش از ابطال آن (ضد Brute-Force). */
export const OTP_MAX_ATTEMPTS = 5;

/** توکن دسترسی JWT — پیش‌فرض ۷ روز اعتبار. */
export const JWT_DEFAULT_EXPIRES_IN = '7d';

/** اعتبار پیش‌فرض توکن دسترسی بر حسب ثانیه (۷ روز) — برای بازگرداندن به کلاینت. */
export const JWT_DEFAULT_EXPIRES_IN_SECONDS = 604800;

/** قالب پیش‌فرض کاوه‌نگار برای دامنه قاضی هوشمند. */
export const KAVENEGAR_TEMPLATE_GHAZI_DEFAULT = 'ghazi-verify';

/** قالب پیش‌فرض کاوه‌نگار برای دامنه روکسیرا. */
export const KAVENEGAR_TEMPLATE_ROXIRA_DEFAULT = 'roxira-verify';

/** آدرس پایه API کاوه‌نگار (Verify Lookup). */
export const KAVENEGAR_BASE_URL = 'https://api.kavenegar.com/v1';

/** توکن تزریق وابستگی کلاینت Redis اختصاصی ماژول Auth. */
export const REDIS_CLIENT = 'ROXIRA_AUTH_REDIS_CLIENT';
