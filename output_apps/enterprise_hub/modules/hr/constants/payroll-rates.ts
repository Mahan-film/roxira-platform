/**
 * Statutory payroll rates and amounts per Jalali year (Iranian labour law,
 * social security and direct-tax law). This is the ONLY place where these
 * numbers live; the payroll engine reads them through `getPayrollRates(year)`.
 *
 * All amounts are in rials (IRR); rates are decimal fractions (7% = 0.07).
 * To add a year, copy the latest entry, change the values and update `source`.
 *
 * Fixed legal rules (not year-dependent, kept here so they are versioned too):
 *   - Overtime premium 40% on the hourly wage (Labour Law art. 59).
 *   - Night work (22:00–06:00) premium 35% on the hourly wage (art. 58).
 *   - Work on Fridays / official holidays: hourly wage + 40% premium (art. 62).
 *   - Hourly wage = monthly wage / 220 (44-hour week, art. 51; 7.33 h/day × 30).
 *   - Social security (Social Security Act art. 28): employee 7%, employer 20%,
 *     unemployment insurance 3% paid by the employer (Unemployment Insurance
 *     Act art. 5) — the employer's total of 23% is shown as 20% + 3%.
 *   - Insurable wage ceiling: 7 × the minimum monthly wage (SSO circular,
 *     unchanged year to year).
 *   - Child allowance (حق اولاد): 3 × minimum daily wage per child. We apply
 *     the child count stored on the employee (`dependants`) and leave the
 *     eligibility check (720 insured days) to HR.
 *   - Employee social-security share is exempt from wage tax (Direct Taxation
 *     Act art. 137); child allowance is not subject to insurance premium.
 */

export interface TaxBracket {
  /** Upper bound of this band of monthly taxable income (IRR, inclusive). */
  upTo: number;
  /** Rate applied to the slice of income that falls inside this band. */
  rate: number;
}

export interface PayrollYearRates {
  /** Jalali year these rates apply to. */
  year: number;
  /** Where the numbers come from (decree / circular / budget law). */
  source: string;
  /**
   * True once the owner/accountant has confirmed the figures against the
   * official circular. Unverified years still calculate but the UI warns.
   */
  verified: boolean;
  /** Minimum daily wage (حداقل مزد روزانه). */
  minDailyWage: number;
  /** Minimum monthly wage on a 30-day basis. */
  minMonthlyWage: number;
  /** Monthly housing allowance (حق مسکن). */
  housingAllowance: number;
  /** Monthly worker food/goods allowance (بن کارگری). */
  foodAllowance: number;
  /** Monthly child allowance per eligible child (حق اولاد). */
  childAllowancePerChild: number;
  /** Monthly seniority base per full year of service (پایه سنوات). */
  seniorityPerYear: number;
  /** Working hours in a month, the divisor for the hourly wage. */
  monthlyWorkHours: number;
  /** Days in a payroll month for daily-rate maths (wage is on a 30-day basis). */
  payrollMonthDays: number;
  overtimePremium: number;
  nightShiftPremium: number;
  holidayPremium: number;
  employeeInsuranceRate: number;
  employerInsuranceRate: number;
  unemploymentInsuranceRate: number;
  /** Monthly ceiling of the insurable wage (سقف دستمزد مشمول بیمه). */
  maxInsurableMonthlyWage: number;
  /** Monthly wage-tax brackets on the whole taxable income (first band is the exemption). */
  taxBrackets: ReadonlyArray<TaxBracket>;
}

const LABOUR_LAW_RULES = {
  monthlyWorkHours: 220,
  payrollMonthDays: 30,
  overtimePremium: 0.4,
  nightShiftPremium: 0.35,
  holidayPremium: 0.4,
  employeeInsuranceRate: 0.07,
  employerInsuranceRate: 0.2,
  unemploymentInsuranceRate: 0.03,
} as const;

/** Multiplier of the minimum monthly wage that caps the insurable wage. */
const MAX_INSURABLE_MULTIPLIER = 7;

function yearRates(
  values: Omit<
    PayrollYearRates,
    keyof typeof LABOUR_LAW_RULES | 'minMonthlyWage' | 'maxInsurableMonthlyWage'
  >,
): PayrollYearRates {
  const minMonthlyWage =
    values.minDailyWage * LABOUR_LAW_RULES.payrollMonthDays;
  return {
    ...LABOUR_LAW_RULES,
    ...values,
    minMonthlyWage,
    maxInsurableMonthlyWage: minMonthlyWage * MAX_INSURABLE_MULTIPLIER,
  };
}

export const PAYROLL_RATES_BY_YEAR: Readonly<Record<number, PayrollYearRates>> =
  {
    1404: yearRates({
      year: 1404,
      verified: true,
      source:
        'Supreme Labour Council wage decree for 1404 (min daily wage 3,463,656 IRR, ' +
        'housing 9,000,000, food 22,000,000, seniority 2,820,000/month); ' +
        'Budget Law 1404 art. on wage tax (monthly exemption 240,000,000 IRR, 10–30% bands).',
      minDailyWage: 3_463_656,
      housingAllowance: 9_000_000,
      foodAllowance: 22_000_000,
      childAllowancePerChild: 3 * 3_463_656,
      seniorityPerYear: 2_820_000,
      taxBrackets: [
        { upTo: 240_000_000, rate: 0 },
        { upTo: 300_000_000, rate: 0.1 },
        { upTo: 380_000_000, rate: 0.15 },
        { upTo: 500_000_000, rate: 0.2 },
        { upTo: 666_666_667, rate: 0.25 },
        { upTo: Number.POSITIVE_INFINITY, rate: 0.3 },
      ],
    }),
    1405: yearRates({
      year: 1405,
      verified: false,
      source:
        'Supreme Labour Council decree of 1404-12-24 for 1405 (+60% minimum wage: ' +
        'min daily wage 5,541,850 IRR, housing 30,000,000, food 22,000,000, ' +
        'seniority 5,000,000/month, child allowance = 3 days of minimum wage); ' +
        'Budget Law 1405 wage tax (monthly exemption 400,000,000 IRR; 10/15/20/25/30% ' +
        'bands at 800M/1,000M/1,200M/1,400M). Figures cross-checked against secondary ' +
        'sources (sepidarsystem.com, e-estekhdam.com, asriran.com, 2026-10-22); ' +
        're-verify against the official circular before relying on them in production.',
      minDailyWage: 5_541_850,
      housingAllowance: 30_000_000,
      foodAllowance: 22_000_000,
      childAllowancePerChild: 3 * 5_541_850,
      seniorityPerYear: 5_000_000,
      taxBrackets: [
        { upTo: 400_000_000, rate: 0 },
        { upTo: 800_000_000, rate: 0.1 },
        { upTo: 1_000_000_000, rate: 0.15 },
        { upTo: 1_200_000_000, rate: 0.2 },
        { upTo: 1_400_000_000, rate: 0.25 },
        { upTo: Number.POSITIVE_INFINITY, rate: 0.3 },
      ],
    }),
  };

/** Rates for a Jalali year, or `null` if that year has not been configured. */
export function getPayrollRates(year: number): PayrollYearRates | null {
  return PAYROLL_RATES_BY_YEAR[year] ?? null;
}

/** Years that have configured rates, ascending. */
export function configuredPayrollYears(): number[] {
  return Object.keys(PAYROLL_RATES_BY_YEAR)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Rates for `year`, else the closest earlier configured year, else the
 * earliest one. For defaults and previews only; payroll runs require
 * `getPayrollRates` to return the exact year.
 */
export function resolvePayrollRates(year: number): PayrollYearRates {
  const years = configuredPayrollYears();
  const match = [...years].reverse().find((candidate) => candidate <= year);
  return PAYROLL_RATES_BY_YEAR[match ?? years[0]];
}
