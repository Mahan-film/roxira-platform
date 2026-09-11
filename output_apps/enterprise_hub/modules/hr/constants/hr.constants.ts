/**
 * ثابت‌ها و پارامترهای قانونی محاسبه حقوق و دستمزد (Payroll).
 *
 * مبالغ بر حسب ریال و نرخ‌ها به‌صورت کسر اعشاری (۷٪ = 0.07) هستند. این
 * مقادیر به‌عنوان پیش‌فرض در قرارداد کار ذخیره می‌شوند و در صورت لزوم
 * به‌صورت قرارداد-به-قرارداد قابل بازنویسی (override) هستند.
 */

/** دقت ریالی مبالغ (تعداد ارقام اعشار) */
export const MONEY_SCALE = 2;

/** نرخ بیمه تأمین اجتماعی سهم کارگر (۷٪) */
export const EMPLOYEE_INSURANCE_RATE = 0.07;

/** نرخ بیمه تأمین اجتماعی سهم کارفرما (۲۳٪) — جهت گزارش هزینه سازمان */
export const EMPLOYER_INSURANCE_RATE = 0.23;

/** پیش‌فرض حق مسکن ماهانه (ریال — سال ۱۴۰۴) */
export const DEFAULT_HOUSING_ALLOWANCE = 9_000_000;

/** پیش‌فرض بن خواربار ماهانه (ریال — سال ۱۴۰۴) */
export const DEFAULT_FOOD_ALLOWANCE = 11_000_000;

/** حداقل حقوق پایه ماهانه (ریال — سال ۱۴۰۴) جهت اعتبارسنجی قرارداد */
export const MIN_BASE_SALARY = 71_661_840;

/**
 * سقف معافیت مالیات بر حقوق ماهانه (ریال).
 * مازاد بر این مبلغ مشمول نرخ‌های پله‌ای زیر است.
 */
export const INCOME_TAX_MONTHLY_EXEMPTION = 24_000_000;

/**
 * پله‌های مالیات بر حقوق ماهانه بر «درآمد مشمول پس از کسر معافیت».
 * نرخ هر پله روی بخشی از درآمد که در همان پله قرار می‌گیرد اعمال می‌شود
 * (نرخ مؤثر پله‌ای/تصاعدی).
 */
export const INCOME_TAX_BRACKETS: ReadonlyArray<{
  /** سقف تجمعی درآمد مشمول این پله (ریال) */
  limit: number;
  /** نرخ مالیات این پله */
  rate: number;
}> = [
  { limit: 25_000_000, rate: 0.1 },
  { limit: 50_000_000, rate: 0.15 },
  { limit: Number.POSITIVE_INFINITY, rate: 0.2 },
];

/** کد حساب دفتر کل برای «هزینه حقوق و دستمزد» (بدهکار سند حقوق) */
export const PAYROLL_EXPENSE_ACCOUNT_CODE = '5010';

/** کد حساب دفتر کل برای «بدهی‌های بیمه و مالیات پرداختنی» (بستانکار سند حقوق) */
export const PAYROLL_PAYABLE_ACCOUNT_CODE = '2010';

/** کد حساب دفتر کل برای «موجودی نقد و بانک» (خالص پرداختی کارمند) */
export const PAYROLL_BANK_ACCOUNT_CODE = '1010';

/** پیشوند شماره‌گذاری خودکار پرسنل */
export const EMPLOYEE_NUMBER_PREFIX = 'EMP';

/** پیشوند شماره‌گذاری خودکار احکام/قراردادهای حقوقی */
export const CONTRACT_NUMBER_PREFIX = 'CT';

/** پیشوند شماره‌گذاری فیش‌های حقوقی */
export const PAYSLIP_NUMBER_PREFIX = 'PS';

/** حداقل سال دوره حقوقی قابل پذیرش */
export const MIN_PERIOD_YEAR = 1390;

/** حداکثر سال دوره حقوقی قابل پذیرش */
export const MAX_PERIOD_YEAR = 1450;
