/**
 * The keys the statutory store accepts and how each value is shaped. Names and kinds only:
 * every figure lives in the `statutory_parameters` table, never in code.
 */
export type StatutoryKind = 'money' | 'rate' | 'count' | 'brackets';

export interface StatutoryKeyDefinition {
  kind: StatutoryKind;
  label: string;
  /** Payroll cannot run without it. */
  required: boolean;
}

export const STATUTORY_KEYS = {
  min_daily_wage: { kind: 'money', label: 'حداقل مزد روزانه', required: true },
  other_levels_percent: { kind: 'rate', label: 'درصد افزایش سایر سطوح مزدی', required: false },
  other_levels_daily_addition: { kind: 'money', label: 'مبلغ روزانه افزایش سایر سطوح مزدی', required: false },
  seniority_daily: { kind: 'money', label: 'پایه سنوات روزانه', required: true },
  food_allowance: { kind: 'money', label: 'کمک‌هزینه اقلام مصرفی خانوار (ماهانه)', required: true },
  marriage_allowance: { kind: 'money', label: 'حق تأهل (ماهانه)', required: false },
  housing_allowance: { kind: 'money', label: 'حق مسکن (ماهانه)', required: true },
  child_allowance_days: { kind: 'count', label: 'حق اولاد (روز حداقل مزد به‌ازای هر فرزند)', required: true },
  monthly_work_hours: { kind: 'count', label: 'ساعت کار ماهانه', required: true },
  payroll_month_days: { kind: 'count', label: 'روزهای مبنای مزد ماهانه', required: true },
  overtime_premium: { kind: 'rate', label: 'فوق‌العاده اضافه‌کار', required: true },
  night_shift_premium: { kind: 'rate', label: 'فوق‌العاده شب‌کاری', required: true },
  holiday_premium: { kind: 'rate', label: 'فوق‌العاده تعطیل‌کاری', required: true },
  employee_insurance_rate: { kind: 'rate', label: 'بیمه سهم کارگر', required: true },
  employer_insurance_rate: { kind: 'rate', label: 'بیمه سهم کارفرما', required: true },
  unemployment_insurance_rate: { kind: 'rate', label: 'بیمه بیکاری', required: true },
  insurable_ceiling_multiplier: { kind: 'count', label: 'سقف دستمزد مشمول بیمه (ضریب حداقل مزد)', required: true },
  wage_tax_annual_brackets: { kind: 'brackets', label: 'پله‌های سالانه مالیات حقوق', required: true },
  wage_flat_tax_rate: { kind: 'rate', label: 'نرخ مقطوع مالیات حقوق', required: false },
  eidi_exempt_ceiling: { kind: 'money', label: 'سقف معافیت عیدی', required: false },
  non_cash_exempt_annual: { kind: 'money', label: 'سقف معافیت سالانه مزایای غیرنقدی', required: false },
  sanavat_days_per_year: { kind: 'count', label: 'روزهای مزد سنوات به‌ازای هر سال خدمت', required: false },
  sanavat_year_days: { kind: 'count', label: 'مبنای روزهای سال برای سنوات کسری سال', required: false },
  vat_general_rate: { kind: 'rate', label: 'نرخ عمومی مالیات بر ارزش افزوده', required: false },
  income_tax_art131_brackets: { kind: 'brackets', label: 'پله‌های مالیات بر درآمد اشخاص حقیقی (ماده ۱۳۱)', required: false },
  income_exemption_ceiling_art57_art101: { kind: 'money', label: 'سقف معافیت درآمد مستغلات (ماده ۵۷) و مشاغل (ماده ۱۰۱)', required: false },
  rental_expense_deduction_rate: { kind: 'rate', label: 'درصد هزینه و استهلاک مالک از اجاره‌بها (ماده ۵۳)', required: false },
  doctor_fee_withholding_rate: { kind: 'rate', label: 'نرخ مالیات علی‌الحساب حق‌الزحمه پزشکان (کسر توسط مراکز درمانی)', required: false },
  withholding_late_penalty_rate: { kind: 'rate', label: 'جریمهٔ عدم کسر یا ایصال مالیات تکلیفی (ماده ۱۹۹)', required: false },
  withholding_late_penalty_monthly_rate: { kind: 'rate', label: 'جریمهٔ ماهانهٔ تأخیر در ایصال مالیات تکلیفی (ماده ۱۹۹)', required: false },
  civil_partnership_max_exemptions: { kind: 'count', label: 'حداکثر تعداد معافیت شرکای مشارکت مدنی (تبصره ۱ ماده ۱۰۱)', required: false },
  corporate_tax_rate: { kind: 'rate', label: 'نرخ مالیات بر درآمد شرکت‌ها', required: false },
  corporate_tax_effective_floor: { kind: 'rate', label: 'حداقل نرخ مؤثر مالیات بر درآمد شرکت‌ها', required: false },
  // Contracting (HR-CON-01). A seeded row may be "unclear": no figure is known, so the value is NULL.
  contract_retention_rate: { kind: 'rate', label: 'سپرده حسن انجام کار (درصد از هر صورت وضعیت)', required: false },
  contract_insurance_deposit_rate: { kind: 'rate', label: 'سپرده بیمه ماده ۳۸ (درصد بهای کل کار)', required: false },
  contract_insurance_rate_mechanical: { kind: 'rate', label: 'ضریب بیمه پیمان غیرعمرانی مکانیزه', required: false },
  contract_insurance_rate_non_mechanical: { kind: 'rate', label: 'ضریب بیمه پیمان غیرعمرانی غیرمکانیزه (دستمزدی)', required: false },
  contract_insurance_rate_civil_executive: { kind: 'rate', label: 'ضریب بیمه پیمان عمرانی اجرایی', required: false },
  contract_insurance_rate_civil_consulting: { kind: 'rate', label: 'ضریب بیمه پیمان عمرانی مشاوره‌ای', required: false },
  contract_unemployment_addon_fraction: { kind: 'rate', label: 'کسر بیمه بیکاری افزوده بر ضریب بیمه پیمان', required: false },
  contract_tax_withholding_rate: { kind: 'rate', label: 'نرخ کسر مالیات پیمانکاران از صورت وضعیت', required: false },
  contract_advance_payment_max_rate: { kind: 'rate', label: 'سقف پیش‌پرداخت قرارداد', required: false },
  // Electronic commercial books upload periodicity in months (Bylaw 95, Art. 6: 1, 3, 6, 12).
  commercial_books_periodicity: { kind: 'count', label: 'دوره زمانی بارگذاری دفاتر تجاری الکترونیکی (ماه)', required: false },
} as const satisfies Record<string, StatutoryKeyDefinition>;

export type StatutoryKey = keyof typeof STATUTORY_KEYS;

export const isStatutoryKey = (key: string): key is StatutoryKey =>
  Object.prototype.hasOwnProperty.call(STATUTORY_KEYS, key);

const RATE = /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/;

const validBrackets = (value: unknown): boolean => {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  let lower = 0;
  return value.every((band: { upTo?: unknown; rate?: unknown }, index) => {
    const last = index === value.length - 1;
    if (typeof band?.rate !== 'string' || !RATE.test(band.rate)) {
      return false;
    }
    if (last) {
      return band.upTo === null;
    }
    if (!Number.isSafeInteger(band.upTo) || (band.upTo as number) <= lower) {
      return false;
    }
    lower = band.upTo as number;
    return true;
  });
};

/** Whether `value` has the shape its key's kind requires. Rates are decimal strings, never floats. */
export function isValidStatutoryValue(key: StatutoryKey, value: unknown): boolean {
  switch (STATUTORY_KEYS[key].kind) {
    case 'money':
    case 'count':
      return Number.isSafeInteger(value) && (value as number) >= 0;
    case 'rate':
      return typeof value === 'string' && RATE.test(value);
    case 'brackets':
      return validBrackets(value);
  }
}
