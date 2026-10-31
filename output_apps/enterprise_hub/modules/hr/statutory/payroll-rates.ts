/**
 * The payroll engine's view of one year's statutory values, built from the
 * `statutory_parameters` table by StatutoryService. All amounts are rials;
 * rates are decimal fractions. No legal figure lives in code.
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
  /** Monthly wage-tax brackets on the whole taxable income (first band is the exemption). */
  taxBrackets: ReadonlyArray<TaxBracket>;
}
