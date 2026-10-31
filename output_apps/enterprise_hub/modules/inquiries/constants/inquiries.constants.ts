/**
 * ثابت‌های ماژول پیش‌ثبت‌نام و درخواست همکاری (Enterprise Inquiries).
 */

/** مسیر پایه کنترلر Inquiries در لایه NestJS (نسخه‌دار: /v1/enterprise/inquiries). */
export const INQUIRIES_RESOURCE = 'enterprise/inquiries';

/**
 * محدودیت نرخ مسیر عمومی ثبت درخواست: حداکثر ۵ درخواست در ساعت برای هر IP
 * (طبق تصمیم مالک، ۲۰۲۶-۱۰-۱۴). گارد سراسری ProxyAwareThrottlerGuard آن را
 * بر مبنای IP واقعی کلاینت اعمال می‌کند.
 */
export const INQUIRY_THROTTLE = { ttl: 3_600_000, limit: 5 } as const;

/** منبع پیش‌فرض درخواست وقتی کلاینت مقداری ارسال نکرده باشد. */
export const DEFAULT_INQUIRY_SOURCE = 'enterprise-hub';

/** Mailbox that receives a notice for every new lead (same variable the frontend uses). */
export const LEAD_NOTIFY_EMAIL_ENV = 'LEAD_NOTIFY_EMAIL';

/** The Next.js upgrade-inquiry route mails the owner itself, so these leads are not mailed twice. */
export const UPGRADE_INQUIRY_SOURCE_PREFIX = 'upgrade-inquiry-';

/** حداکثر طول متن پیام درخواست. */
export const MAX_INQUIRY_MESSAGE_LENGTH = 4000;

/** الگوی پایه رایانامه (اعتبارسنجی لایه سرویس). */
export const INQUIRY_EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** الگوی پایه شماره تماس (اعتبارسنجی لایه سرویس). */
export const INQUIRY_PHONE_REGEX = /^[0-9+\-\s()]{7,20}$/;

/** منبع فرم فهرست انتظار پایلوت حقوقی مالزی؛ ثبت بدون رضایت صریح پذیرفته نمی‌شود. */
export const MY_LEGAL_WAITLIST_SOURCE = 'my-legal-waitlist';
