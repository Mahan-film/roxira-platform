/**
 * Seed of `statutory_parameters`, applied once by migration 1789410000000 and also used by tests.
 * Later changes are new rows through the API or a new migration; do not edit a value here.
 *
 * Provenance:
 *  - OFFICIAL / verified: Supreme Labour Council wage circular 6682 of 1405-01-31
 *    (docs/legal_sources/iran/wage-circular-1405.txt).
 *  - REPORT / unverified: docs/research/2026-10-31/05-iran-compliance-1405-fa.md.
 *  - LEGACY / unverified: figures the payroll code carried before this table existed.
 */
const OFFICIAL_1405 =
  'بخشنامه مزد ۱۴۰۵ شورای عالی کار، شماره ۶۶۸۲ مورخ ۱۴۰۵/۰۱/۳۱';
const REPORT_1405 =
  'گزارش پژوهشی انطباق ۱۴۰۵ (docs/research/2026-10-31/05-iran-compliance-1405-fa.md)؛ با متن رسمی تطبیق نشده';
const LEGACY =
  'مقدار پیشین کد حقوق (constants/payroll-rates.ts)؛ با متن رسمی تطبیق نشده';

export const seedEffectiveFrom = (fiscalYear: number): string =>
  fiscalYear === 1404 ? '2025-03-21' : '2026-03-21';

export type Seed = [
  fiscalYear: number,
  key: string,
  value: unknown,
  sourceKind: 'OFFICIAL' | 'REPORT' | 'LEGACY',
];

const STATUTE_DEFAULTS = (year: number): Seed[] => [
  [year, 'monthly_work_hours', 220, 'LEGACY'],
  [year, 'payroll_month_days', 30, 'LEGACY'],
  [year, 'overtime_premium', '0.4', 'LEGACY'],
  [year, 'night_shift_premium', '0.35', 'LEGACY'],
  [year, 'holiday_premium', '0.4', 'LEGACY'],
  [year, 'child_allowance_days', 3, 'LEGACY'],
  [year, 'insurable_ceiling_multiplier', 7, 'LEGACY'],
  [year, 'employee_insurance_rate', '0.07', 'REPORT'],
  [year, 'employer_insurance_rate', '0.2', 'REPORT'],
  [year, 'unemployment_insurance_rate', '0.03', 'REPORT'],
];

export const STATUTORY_SEEDS: Seed[] = [
  // 1404: none of these were checked against an official text in this repository.
  [1404, 'min_daily_wage', 3_463_656, 'LEGACY'],
  [1404, 'seniority_daily', 94_000, 'LEGACY'],
  [1404, 'food_allowance', 22_000_000, 'LEGACY'],
  [1404, 'housing_allowance', 9_000_000, 'LEGACY'],
  [
    1404,
    'wage_tax_annual_brackets',
    [
      { upTo: 2_880_000_000, rate: '0' },
      { upTo: 3_600_000_000, rate: '0.1' },
      { upTo: 4_560_000_000, rate: '0.15' },
      { upTo: 6_000_000_000, rate: '0.2' },
      { upTo: 8_000_000_000, rate: '0.25' },
      { upTo: null, rate: '0.3' },
    ],
    'LEGACY',
  ],
  ...STATUTE_DEFAULTS(1404),

  // 1405: circular 6682 items 1 to 4.
  [1405, 'min_daily_wage', 5_541_850, 'OFFICIAL'],
  [1405, 'other_levels_percent', '0.45', 'OFFICIAL'],
  [1405, 'other_levels_daily_addition', 519_549, 'OFFICIAL'],
  [1405, 'seniority_daily', 166_667, 'OFFICIAL'],
  [1405, 'food_allowance', 22_000_000, 'OFFICIAL'],
  [1405, 'marriage_allowance', 5_000_000, 'OFFICIAL'],

  // 1405: not in the circular text.
  [1405, 'housing_allowance', 30_000_000, 'LEGACY'],
  [
    1405,
    'wage_tax_annual_brackets',
    [
      { upTo: 4_800_000_000, rate: '0' },
      { upTo: 9_600_000_000, rate: '0.1' },
      { upTo: 12_000_000_000, rate: '0.15' },
      { upTo: 14_400_000_000, rate: '0.2' },
      { upTo: 16_800_000_000, rate: '0.25' },
      { upTo: null, rate: '0.3' },
    ],
    'REPORT',
  ],
  [1405, 'wage_flat_tax_rate', '0.1', 'REPORT'],
  [1405, 'eidi_exempt_ceiling', 400_000_000, 'REPORT'],
  [1405, 'non_cash_exempt_annual', 800_000_000, 'REPORT'],
  [1405, 'vat_general_rate', '0.1', 'REPORT'],
  ...STATUTE_DEFAULTS(1405),
];

export const seedSource = ([, , , kind]: Seed): string =>
  kind === 'OFFICIAL' ? OFFICIAL_1405 : kind === 'REPORT' ? REPORT_1405 : LEGACY;
