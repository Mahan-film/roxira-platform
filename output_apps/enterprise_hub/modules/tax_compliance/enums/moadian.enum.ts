/**
 * شمارشی‌های سامانه مودیان (API v2) و وضعیت ارسال هر صورتحساب.
 * کدها از SDKهای عمومی استخراج شده‌اند؛ docs/research/MOADIAN_REQUIREMENTS_2026-10-14.md §8.
 */

/** نوع صورتحساب (inty): ۱ = با مشخصات خریدار، ۲ = بدون مشخصات خریدار، ۳ = فروشگاهی. */
export enum MoadianInvoiceType {
  WITH_BUYER = 1,
  WITHOUT_BUYER = 2,
  RETAIL = 3,
}

/** الگوی صورتحساب (inp). */
export enum MoadianInvoicePattern {
  SALE = 1,
  SALE_CURRENCY = 2,
  GOLD = 3,
  CONTRACT = 4,
  UTILITY_BILLS = 5,
  AIRLINE_TICKET = 6,
  EXPORT = 7,
}

/** موضوع صورتحساب (ins). */
export enum MoadianInvoiceSubject {
  MAIN = 1,
  CORRECTIVE = 2,
  CANCELLATION = 3,
  RETURN = 4,
}

/** نوع شخص خریدار (tob). */
export enum MoadianBuyerType {
  NATURAL = 1,
  LEGAL = 2,
  CIVIC = 3,
  FOREIGN_NATIONAL = 4,
  FINAL_CONSUMER = 5,
}

/** روش تسویه (setm). */
export enum MoadianSettlementMethod {
  CASH = 1,
  CREDIT = 2,
  CASH_AND_CREDIT = 3,
}

/** وضعیت استعلام برگشتی از /inquiry-by-* . */
export enum MoadianInquiryStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
}

/**
 * وضعیت ارسال یک صورتحساب به مودیان (سمت ما).
 *
 * QUEUED: در صف BullMQ برای ارسال.
 * SENT: بسته پذیرفته شد و referenceNumber گرفت؛ در انتظار نتیجه استعلام.
 * SUCCESS: استعلام موفق — صورتحساب در سامانه ثبت شد.
 * FAILED: استعلام ناموفق (خطای اعتبارسنجی مودیان) — اصلاح و ارسال مجدد لازم است.
 * ERROR: خطای انتقال/پیکربندی پس از اتمام تلاش‌های مجدد.
 * UNKNOWN: تایم‌اوت/5xx؛ نمی‌دانیم بسته رسیده یا نه. هرگز FAILED نیست و uid/taxid عوض نمی‌شود؛
 *   پیش از هر ارسال مجدد باید inquiry-by-uid اجرا شود (docs/tax/TAX_TRANSMISSION_DESIGN.md).
 */
export enum MoadianSubmissionStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ERROR = 'ERROR',
  UNKNOWN = 'UNKNOWN',
}
