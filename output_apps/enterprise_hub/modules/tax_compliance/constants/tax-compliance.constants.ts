/**
 * ثابت‌های دامنه «تطبیق سامانه مودیان و امضای الکترونیک صورتحساب‌ها».
 *
 * تمام مقادیر این فایل مستقل از کلاینت هستند و فقط در لایه Service استفاده
 * می‌شوند تا قرارداد رمزنگاری/مالیاتی در یک نقطه متمرکز بماند
 * (Rule #4 - AGENTS.md: Contract-First Synchronization).
 */

/** طول ثابت شناسه یکتای مالیاتی (TaxID) طبق الزام سامانه مودیان. */
export const TAX_ID_LENGTH = 22;

/** فضای نام داخلی که در تولید قطعی/قطعی‌سازی TaxID نقش نمک (Salt) را دارد. */
export const TAX_ID_NAMESPACE = 'ROXIRA-MOADIAN-TAX-ID-V1';

/** الگوریتم هش بسته صورتحساب. */
export const HASH_ALGORITHM = 'sha256';

/** الگوریتم امضای دیجیتال JWS (RSA + SHA-256 در قالب JOSE). */
export const JWS_SIGNATURE_ALGORITHM = 'RS256';

/** نوع JOSE برای هدر توکن امضا. */
export const JWS_TOKEN_TYPE = 'JOSE';

/** طول کلید RSA برای امضای مالیاتی (بیت). */
export const RSA_MODULUS_LENGTH = 2048;

/** نسخه بسته امضاشده که به سامانه مودیان ارسال می‌شود. */
export const TAX_PACKET_VERSION = '1.0';

/** نام مرجع مالیاتی (Organizational Issuer) در JWS. */
export const TAX_AUTHORITY_ISSUER = 'ROXIRA-ENTERPRISE-HUB';

/** نشانی پایه سامانه مودیان برای تولید محتوای QR راستی‌آزمایی. */
export const TAX_AUTHORITY_VERIFY_BASE_URL = 'https://moadian.gov.ir/verify';

/** پیشوند شناسه یکتای کلید امضا. */
export const SIGNING_KEY_ID_PREFIX = 'ROXIRA-TAX-KEY';

/** پیشوند شماره مرجع ارسال بسته به سامانه مودیان. */
export const TAX_SUBMISSION_REFERENCE_PREFIX = 'MDN';

/** مقدار پیش‌فرض صفحه‌بندی فهرست امضاها. */
export const TAX_SIGNATURE_PAGE_SIZE_DEFAULT = 20;

/** حداکثر اندازه صفحه در فهرست امضاها. */
export const TAX_SIGNATURE_PAGE_SIZE_MAX = 100;

/** حداقل تعداد کاراکترهای PEM کلید خصوصی پذیرفته‌شده از کلاینت. */
export const MIN_PRIVATE_KEY_PEM_LENGTH = 256;
