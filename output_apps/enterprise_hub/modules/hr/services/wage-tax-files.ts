/**
 * Working files for the wage-tax system (salary.tax.gov.ir). The research report says only WP
 * (identity of new or changed staff) and WH (work and pay detail) are uploaded, as TXT or ZIP, and
 * lists what they contain; it gives no field order, separator or code table, and neither did a web
 * search. So these are NOT the upload files: they are CSV with our own column names, for an
 * accountant to check and key in, and `uploadReady` stays false until an official spec is in the
 * repo. See docs/hr/STATUTORY_OPEN_ITEMS.md.
 */
export type WageTaxListType = 'MAIN' | 'ADDITIONAL' | 'CORRECTIVE';

export interface WageTaxPerson {
  nationalId: string;
  firstName: string;
  lastName: string;
  fatherName: string | null;
  /** Compact Jalali, or ''. */
  birthDate: string;
  /** Started in this period, so the person belongs in WP. */
  isNew: boolean;
  workDays: number;
  basePay: number;
  overtimePay: number;
  allowances: number;
  nonCash: number;
  eidi: number;
  grossPay: number;
  employeeInsurance: number;
  taxableIncome: number;
  incomeTax: number;
}

export interface WageTaxFiles {
  wpFileName: string;
  wpFile: string;
  whFileName: string;
  whFile: string;
  uploadReady: boolean;
  /** What no source confirms (docs/legal_sources/iran/wage-tax-files-fields.md). */
  unverified: string[];
  /** Our tax next to the run total, for checking against the tax system's own calculation. */
  totalGross: number;
  totalTax: number;
  warnings: string[];
}

export const WAGE_TAX_UNVERIFIED: ReadonlyArray<string> = [
  'قالب رکورد WP و WH (ترتیب، عرض، جداکننده) در هیچ منبعی که خوانده شد نیامده است؛ دفترچه رسمی در دسترس نبود',
  'نام و پسوند فایل (WPYYYYMM.TXT) و رمزگذاری متن تأیید نشده است',
  'جدول کدها (نوع لیست، نوع پرداخت، نوع ارز، وضعیت اشتغال) تأیید نشده است',
  'اقلام WH که هنوز ساخته نمی‌شوند: ماه‌های کارکرد از ابتدای سال، تاریخ شروع و ترک کار، وضعیت اشتغال، پرداخت‌های معوق',
  'اقلام WP که هنوز ذخیره نمی‌شوند: محل خدمت، نوع استخدام، مدرک تحصیلی، ملیت، تلفن، نشانی؛ تشخیص تغییر مشخصات هم ساخته نشده',
];

const WP_COLUMNS = [
  'national_id',
  'first_name',
  'last_name',
  'father_name',
  'birth_date',
] as const;

const WH_COLUMNS = [
  'national_id',
  'list_type',
  'period',
  'work_days',
  'base_pay',
  'overtime_pay',
  'allowances',
  'non_cash',
  'eidi',
  'gross_pay',
  'employee_insurance',
  'taxable_income',
  'income_tax',
] as const;

const cell = (value: string | number): string => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csv = (columns: ReadonlyArray<string>, rows: (string | number)[][]): string =>
  [columns.join(','), ...rows.map((row) => row.map(cell).join(','))]
    .join('\r\n')
    .concat('\r\n');

export function buildWageTaxFiles(
  periodYear: number,
  periodMonth: number,
  listType: WageTaxListType,
  people: ReadonlyArray<WageTaxPerson>,
  expected: { totalGross: number; totalTax: number },
): WageTaxFiles {
  const period = `${periodYear}${String(periodMonth).padStart(2, '0')}`;
  const totalGross = people.reduce((sum, p) => sum + p.grossPay, 0);
  const totalTax = people.reduce((sum, p) => sum + p.incomeTax, 0);
  if (totalGross !== expected.totalGross || totalTax !== expected.totalTax) {
    throw new Error(
      `wage tax rows disagree with the run: ${totalGross}/${totalTax} != ${expected.totalGross}/${expected.totalTax}`,
    );
  }
  return {
    wpFileName: `WP-${period}-working.csv`,
    wpFile: csv(
      WP_COLUMNS,
      people
        .filter((p) => p.isNew)
        .map((p) => [p.nationalId, p.firstName, p.lastName, p.fatherName ?? '', p.birthDate]),
    ),
    whFileName: `WH-${period}-working.csv`,
    whFile: csv(
      WH_COLUMNS,
      people.map((p) => [
        p.nationalId,
        listType,
        period,
        p.workDays,
        p.basePay,
        p.overtimePay,
        p.allowances,
        p.nonCash,
        p.eidi,
        p.grossPay,
        p.employeeInsurance,
        p.taxableIncome,
        p.incomeTax,
      ]),
    ),
    uploadReady: WAGE_TAX_UNVERIFIED.length === 0,
    unverified: [...WAGE_TAX_UNVERIFIED],
    totalGross,
    totalTax,
    warnings: [
      'این دو فایل برگه کاری هستند و قالب بارگذاری سامانه مالیات حقوق نیستند.',
    ],
  };
}
