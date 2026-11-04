/** حداکثر تعداد اقلام کالا/خدمت قابل قبول در هر صورتحساب */
export const MAX_INVOICE_ITEMS = 200;

/*
 * The general VAT rate is not a code constant: it is read by invoice date from the statutory
 * store (`vat_general_rate`), see services/vat-rate.resolver.ts. Tests use
 * __fixtures__/vat-rate.fixture.ts.
 */

/**
 * نرخ پیش‌فرض VAT صورتحساب‌های بین‌المللی (INTL): صفر، مگر اینکه نرخ هر سطر
 * به‌صورت صریح داده شود.
 */
export const INTL_DEFAULT_VAT_RATE = 0;

/** ضریب تبدیل تومان به ریال (۱ تومان = ۱۰ ریال). */
export const TOMAN_TO_RIAL = 10;

/** دقت گردن‌دکردن مبالغ ریالی/مالی (تعداد ارقام اعشار) */
export const MONEY_SCALE = 2;

/** پیشوند پیشنهادی شماره صورتحساب مالیاتی جهت تولید خودکار */
export const DEFAULT_TAX_INVOICE_NUMBER_PREFIX = 'TI';
