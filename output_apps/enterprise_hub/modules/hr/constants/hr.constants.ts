/**
 * ثابت‌ها و پارامترهای قانونی محاسبه حقوق و دستمزد (Payroll).
 *
 * مبالغ بر حسب ریال و نرخ‌ها به‌صورت کسر اعشاری (۷٪ = 0.07) هستند. این
 * مقادیر به‌عنوان پیش‌فرض در قرارداد کار ذخیره می‌شوند و در صورت لزوم
 * به‌صورت قرارداد-به-قرارداد قابل بازنویسی (override) هستند.
 */

/** دقت ریالی مبالغ (تعداد ارقام اعشار) */
import { findTemplate } from '../../posting_rules/domain/posting-templates';

export const MONEY_SCALE = 2;

// Statutory rates and amounts (insurance, allowances, minimum wage, wage-tax
// bands) live per Jalali year in ./payroll-rates.ts — do not add them here.

const runDefaults = () => findTemplate('payroll.run')?.defaults ?? {};
const payslipDefaults = () => findTemplate('payroll.payslip')?.defaults ?? {};

/** کد حساب دفتر کل برای «هزینه حقوق و دستمزد» (بدهکار سند حقوق) */
export const PAYROLL_EXPENSE_ACCOUNT_CODE = payslipDefaults().payroll_expense ?? '5010';

/** کد حساب دفتر کل برای «بدهی‌های بیمه و مالیات پرداختنی» (بستانکار سند حقوق) */
export const PAYROLL_PAYABLE_ACCOUNT_CODE = payslipDefaults().payroll_payable ?? '2010';

/** کد حساب دفتر کل برای «موجودی نقد و بانک» (خالص پرداختی کارمند) */
export const PAYROLL_BANK_ACCOUNT_CODE = payslipDefaults().bank ?? '1010';

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

/**
 * Ledger accounts used when a monthly payroll run is posted. Missing ones are
 * created in the tenant's chart on first posting; an existing account with the
 * same code is reused as is. Codes derive from the posting template defaults.
 */
export const PAYROLL_RUN_ACCOUNTS = {
  salaryExpense: {
    get code() {
      return runDefaults().payroll_expense ?? '5010';
    },
    name: 'هزینه حقوق و دستمزد',
    kind: 'EXPENSE',
  },
  employerInsuranceExpense: {
    get code() {
      return runDefaults().employer_insurance_expense ?? '5040';
    },
    name: 'هزینه بیمه سهم کارفرما و بیمه بیکاری',
    kind: 'EXPENSE',
  },
  insurancePayable: {
    get code() {
      return runDefaults().insurance_payable ?? '2030';
    },
    name: 'حق بیمه پرداختنی تأمین اجتماعی',
    kind: 'LIABILITY',
  },
  wageTaxPayable: {
    get code() {
      return runDefaults().wage_tax_payable ?? '2040';
    },
    name: 'مالیات حقوق پرداختنی',
    kind: 'LIABILITY',
  },
  salariesPayable: {
    get code() {
      return runDefaults().payroll_payable ?? '2050';
    },
    name: 'حقوق و دستمزد پرداختنی',
    kind: 'LIABILITY',
  },
  otherDeductionsPayable: {
    get code() {
      return runDefaults().other_deductions_payable ?? '2060';
    },
    name: 'سایر کسورات حقوق پرداختنی',
    kind: 'LIABILITY',
  },
};

/** Journal entry number prefix of a posted payroll run (PR-140507). */
export const PAYROLL_RUN_ENTRY_PREFIX = 'PR';
