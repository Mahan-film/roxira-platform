/** حداکثر تعداد اقلام کالا/خدمت قابل قبول در هر صورتحساب */
export const MAX_INVOICE_ITEMS = 200;

/**
 * نرخ پیش‌فرض مالیات بر ارزش افزوده (VAT) — قابل بازنویسی با تنظیم هر مستأجر
 * (`tenants.default_vat_rate`). مقدار به‌صورت نسبت (۰٫۱ = ۱۰٪) ذخیره می‌شود و
 * نرخ نهایی هر سطر روی همان سطر صورتحساب نگه داشته می‌شود.
 */
export const DEFAULT_VAT_RATE = 0.1;

/** نام سازگار با نسخه قبلی؛ همان نرخ پیش‌فرض ۱۰٪ است. */
export const VAT_RATE = DEFAULT_VAT_RATE;

/** دقت گردن‌دکردن مبالغ ریالی/مالی (تعداد ارقام اعشار) */
export const MONEY_SCALE = 2;

/** پیشوند پیشنهادی شماره صورتحساب مالیاتی جهت تولید خودکار */
export const DEFAULT_TAX_INVOICE_NUMBER_PREFIX = 'TI';
