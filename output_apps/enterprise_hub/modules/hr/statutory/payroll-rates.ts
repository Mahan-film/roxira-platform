/**
 * The payroll engine's view of one year's statutory values, built from the
 * `statutory_parameters` table by StatutoryService. All amounts are rials;
 * rates are decimal fractions. No legal figure lives in code.
 */

export interface AnnualTaxBracket {
  /** Upper bound of this band of annual taxable income (IRR); null for the last band. */
  upTo: number | null;
  /** Decimal string, so tax is computed exactly. */
  rate: string;
}

export interface PayrollYearRates {
  /** Jalali year these rates apply to. */
  year: number;
  /** Where the numbers come from (decree / circular / budget law). */
  source: string;
  /** True only when every value in force is verified against an official text. */
  verified: boolean;
  /** Keys of the values in force that are not verified (shown in the UI, stored on the run). */
  unverifiedKeys: string[];
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
  /** Seniority per full year of service on the monthly day basis (پایه سنوات). */
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
  /** Annual wage-tax brackets; the first band is the exemption, the last has `upTo` null. */
  annualTaxBrackets: ReadonlyArray<AnnualTaxBracket>;
  /** Monthly marriage allowance (حق تأهل). */
  marriageAllowance: number;
  /** Flat wage-tax rate as a decimal string, or null if not configured. */
  flatTaxRate: string | null;
  /** Eidi exempt per year, in rials; null means not configured, so nothing is exempt. */
  eidiExemptCeiling: number | null;
  /** Non-cash benefits exempt per year, in rials; null means not configured. */
  nonCashExemptAnnual: number | null;
  /** Decimal-string insurance rates, used for exact rial arithmetic. */
  insuranceRates: { employee: string; employer: string; unemployment: string };
}
