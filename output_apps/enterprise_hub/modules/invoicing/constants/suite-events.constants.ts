import { AccountType } from '../../accounting/enums/accounting.enum';

/**
 * نام صف BullMQ برای رویدادهای بین ماژولی مجموعه (Suite Events).
 *
 * @nestjs/event-emitter در وابستگی‌های پروژه نیست؛ بنابراین رویدادها از طریق
 * BullMQ (که پیش‌تر در AppModule پیکربندی شده) و صف `suite-events` منتشر و
 * مصرف می‌شوند. این کار رشتهٔ HTTP را بلاک نمی‌کند (Rule #5 - AGENTS.md).
 */
export const SUITE_EVENTS_QUEUE = 'suite-events';

/** نام کار (job) تغییر وضعیت صورتحساب. */
export const SUITE_EVENT_INVOICE_STATUS_JOB = 'invoice.status';

/** رویداد تغییر وضعیت صورتحساب که در صف منتشر می‌شود. */
export interface SuiteInvoiceStatusEvent {
  tenantId: string;
  invoiceId: string;
  status: string;
}

/**
 * مشخصات یک حساب دفتر کل برای ثبت خودکار اسناد صورتحساب.
 *
 * ابتدا حساب موجودِ مستأجر با همان ماهیت و نامی که یکی از `match`‌ها را دارد
 * جست‌وجو می‌شود؛ در نبود آن، حساب با `code` و اگر نبود، حساب پیش‌فرض ساخته
 * می‌شود. کد پایه از تنظیم مستأجر خوانده نمی‌شود چون چنین ستون تنظیمی وجود
 * ندارد؛ در آینده می‌توان آن را جایگزین `code` کرد.
 */
export interface InvoiceAccountSpec {
  /** کد پیش‌فرض حسابی که در نبود تطابق نام ساخته می‌شود. */
  code: string;
  /** نام حساب پیش‌فرض. */
  name: string;
  accountType: AccountType;
  /** زیررشته‌های نام که تطابق با حساب موجود را ممکن می‌کنند. */
  match: string[];
  /** زیررشته‌هایی که حساب را از تطابق خارج می‌کنند (مثلاً «اسناد»: اسناد مانده تجاری نیستند). */
  exclude?: string[];
}

/** حساب‌های دریافتنی (AR) — دارایی، پیش‌فرض کد ۱۲۰۱. */
export const RECEIVABLE_ACCOUNT: InvoiceAccountSpec = {
  code: '1201',
  name: 'حساب‌های دریافتنی تجاری',
  accountType: AccountType.ASSET,
  match: ['دریافتنی'],
  exclude: ['اسناد', 'سایر', 'مشکوک'],
};

/** درآمد فروش — پیش‌فرض کد ۴۱۰۱. */
export const SALES_ACCOUNT: InvoiceAccountSpec = {
  code: '4101',
  name: 'درآمد فروش',
  accountType: AccountType.REVENUE,
  match: ['فروش'],
  exclude: ['برگشت', 'تخفیف'],
};

/** مالیات بر ارزش افزوده پرداختنی — پیش‌فرض کد ۲۳۰۱. */
export const VAT_ACCOUNT: InvoiceAccountSpec = {
  code: '2301',
  name: 'مالیات بر ارزش افزوده پرداختنی',
  accountType: AccountType.LIABILITY,
  match: ['مالیات'],
  exclude: ['ذخیره', 'حقوق', 'بیمه', 'عملکرد', 'خرید'],
};

/** نقد و بانک — دارایی، پیش‌فرض کد ۱۰۱۰. */
export const CASH_BANK_ACCOUNT: InvoiceAccountSpec = {
  code: '1010',
  name: 'موجودی نقد و بانک',
  accountType: AccountType.ASSET,
  match: ['بانک', 'صندوق'],
  exclude: ['اسناد', 'تنخواه'],
};

/** موجودی کالا — دارایی، پیش‌فرض کد ۱۳۰۱. */
export const INVENTORY_ACCOUNT: InvoiceAccountSpec = {
  code: '1301',
  name: 'موجودی کالا',
  accountType: AccountType.ASSET,
  match: ['موجودی کالا', 'موجودی انبار'],
};

/** بهای تمام‌شده کالای فروش‌رفته — هزینه، پیش‌فرض کد ۵۱۰۱. */
export const COGS_ACCOUNT: InvoiceAccountSpec = {
  code: '5101',
  name: 'بهای تمام‌شده کالای فروش‌رفته',
  accountType: AccountType.EXPENSE,
  match: ['بهای تمام'],
};

/** خرید کالا و خدمات غیرانباری — هزینه، پیش‌فرض کد ۵۲۰۱. */
export const PURCHASES_ACCOUNT: InvoiceAccountSpec = {
  code: '5201',
  name: 'خرید کالا و خدمات',
  accountType: AccountType.EXPENSE,
  match: ['خرید'],
};

/** حساب‌های پرداختنی تجاری — بدهی، پیش‌فرض کد ۲۱۰۱. */
export const PAYABLE_ACCOUNT: InvoiceAccountSpec = {
  code: '2101',
  name: 'حساب‌های پرداختنی تجاری',
  accountType: AccountType.LIABILITY,
  match: ['پرداختنی تجاری', 'حساب‌های پرداختنی'],
  exclude: ['اسناد', 'سایر'],
};

/** مالیات بر ارزش افزوده خرید (اعتبار مالیاتی) — دارایی، پیش‌فرض کد ۱۴۰۱. */
export const VAT_RECEIVABLE_ACCOUNT: InvoiceAccountSpec = {
  code: '1401',
  name: 'مالیات بر ارزش افزوده خرید (اعتبار مالیاتی)',
  accountType: AccountType.ASSET,
  match: ['اعتبار مالیاتی', 'ارزش افزوده خرید'],
};

/** حساب واسط پوز (طلب از شرکت پرداخت تا واریز بانکی) — دارایی، پیش‌فرض کد ۱۰۱۵. */
export const POS_CLEARING_ACCOUNT: InvoiceAccountSpec = {
  code: '1015',
  name: 'حساب واسط پوز',
  accountType: AccountType.ASSET,
  match: ['واسط پوز', 'پوز'],
};

/** How a sale was paid; each method lands in its own ledger account. */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** حداکثر طول متن خطای ثبت ذخیره‌شده روی صورتحساب. */
export const MAX_POSTING_ERROR_LENGTH = 2000;
