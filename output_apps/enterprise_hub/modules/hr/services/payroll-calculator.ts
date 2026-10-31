import { PayrollYearRates, TaxBracket } from '../statutory/payroll-rates';

/**
 * Pure payroll engine (no I/O): one employee, one Jalali month.
 *
 * Order of operations:
 *   1. Earnings: base wage, seniority (پایه سنوات), housing, food (بن), child
 *      allowance, overtime (+40%), night-shift premium (35%), holiday work (+40%).
 *   2. Absence: unpaid days deduct the daily share of base + seniority +
 *      housing + food (monthly amounts are on a 30-day basis).
 *   3. Insurance: insurable wage = gross − child allowance, capped at the yearly
 *      ceiling; employee 7%, employer 20%, unemployment 3%.
 *   4. Wage tax: progressive bands on (gross − employee insurance).
 *   5. Net = gross − employee insurance − wage tax − other deductions.
 *
 * All results are whole rials (IRR has no fractional unit in practice).
 */
export interface PayrollInput {
  rates: PayrollYearRates;
  /** Contract monthly base wage (30-day basis). */
  monthlyBaseWage: number;
  housingAllowance: number;
  foodAllowance: number;
  /** Child allowance override from the contract; `null`/0 → derived from `children`. */
  childAllowanceOverride?: number | null;
  children: number;
  /** Full years of service at the end of the period. */
  seniorityYears: number;
  overtimeHours?: number;
  /** Overtime already priced in rials (legacy single-payslip endpoint). */
  fixedOvertimeAmount?: number;
  nightHours?: number;
  holidayHours?: number;
  absenceDays?: number;
  otherDeductions?: number;
  /** Contract is subject to social-security premium. */
  insuranceSubject?: boolean;
}

export interface PayrollResult {
  baseWage: number;
  seniorityAmount: number;
  housingAllowance: number;
  foodAllowance: number;
  childAllowance: number;
  hourlyWage: number;
  overtimeAmount: number;
  nightShiftAmount: number;
  holidayAmount: number;
  absenceDeduction: number;
  grossPay: number;
  insurableWage: number;
  employeeInsurance: number;
  employerInsurance: number;
  unemploymentInsurance: number;
  taxableIncome: number;
  incomeTax: number;
  otherDeductions: number;
  netPay: number;
  /** Paid days in the month (30 − absence), used by the insurance list. */
  workDays: number;
  /** Daily wage (base + seniority) / 30, used by the insurance list. */
  dailyWage: number;
}

const rial = (value: number): number => Math.round(value);

const nonNegative = (value: number | undefined): number =>
  Math.max(0, Number(value ?? 0) || 0);

/** Progressive tax on the whole monthly taxable income. */
export function progressiveTax(
  taxableIncome: number,
  brackets: ReadonlyArray<TaxBracket>,
): number {
  let lower = 0;
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= lower) {
      break;
    }
    const slice = Math.min(taxableIncome, bracket.upTo) - lower;
    tax += slice * bracket.rate;
    lower = bracket.upTo;
  }
  return rial(tax);
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const { rates } = input;
  const days = rates.payrollMonthDays;

  const baseWage = rial(nonNegative(input.monthlyBaseWage));
  const seniorityAmount = rial(
    Math.floor(nonNegative(input.seniorityYears)) * rates.seniorityPerYear,
  );
  const housingAllowance = rial(nonNegative(input.housingAllowance));
  const foodAllowance = rial(nonNegative(input.foodAllowance));
  const override = nonNegative(input.childAllowanceOverride ?? 0);
  const childAllowance = rial(
    override > 0
      ? override
      : Math.floor(nonNegative(input.children)) * rates.childAllowancePerChild,
  );

  const hourlyBase = (baseWage + seniorityAmount) / rates.monthlyWorkHours;
  const overtimeAmount = rial(
    nonNegative(input.overtimeHours) *
      hourlyBase *
      (1 + rates.overtimePremium) +
      nonNegative(input.fixedOvertimeAmount),
  );
  const nightShiftAmount = rial(
    nonNegative(input.nightHours) * hourlyBase * rates.nightShiftPremium,
  );
  const holidayAmount = rial(
    nonNegative(input.holidayHours) * hourlyBase * (1 + rates.holidayPremium),
  );

  const absenceDays = Math.min(days, nonNegative(input.absenceDays));
  const absenceDeduction = rial(
    ((baseWage + seniorityAmount + housingAllowance + foodAllowance) / days) *
      absenceDays,
  );

  const grossPay = rial(
    baseWage +
      seniorityAmount +
      housingAllowance +
      foodAllowance +
      childAllowance +
      overtimeAmount +
      nightShiftAmount +
      holidayAmount -
      absenceDeduction,
  );

  const insuranceSubject = input.insuranceSubject ?? true;
  const insurableWage = insuranceSubject
    ? rial(
        Math.min(
          Math.max(0, grossPay - childAllowance),
          rates.maxInsurableMonthlyWage,
        ),
      )
    : 0;
  const employeeInsurance = rial(insurableWage * rates.employeeInsuranceRate);
  const employerInsurance = rial(insurableWage * rates.employerInsuranceRate);
  const unemploymentInsurance = rial(
    insurableWage * rates.unemploymentInsuranceRate,
  );

  const taxableIncome = Math.max(0, grossPay - employeeInsurance);
  const incomeTax = progressiveTax(taxableIncome, rates.taxBrackets);
  const otherDeductions = rial(nonNegative(input.otherDeductions));
  const netPay = grossPay - employeeInsurance - incomeTax - otherDeductions;

  return {
    baseWage,
    seniorityAmount,
    housingAllowance,
    foodAllowance,
    childAllowance,
    hourlyWage: rial(hourlyBase),
    overtimeAmount,
    nightShiftAmount,
    holidayAmount,
    absenceDeduction,
    grossPay,
    insurableWage,
    employeeInsurance,
    employerInsurance,
    unemploymentInsurance,
    taxableIncome,
    incomeTax,
    otherDeductions,
    netPay,
    workDays: days - absenceDays,
    dailyWage: rial((baseWage + seniorityAmount) / days),
  };
}

/**
 * Full years of service from `hireDate` (ISO Gregorian) to `periodEnd`
 * (ISO Gregorian). Returns 0 for missing or future hire dates.
 */
export function serviceYears(
  hireDate: string | null | undefined,
  periodEnd: Date,
): number {
  if (!hireDate) {
    return 0;
  }
  const hire = new Date(`${hireDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(hire.getTime()) || hire > periodEnd) {
    return 0;
  }
  let years = periodEnd.getUTCFullYear() - hire.getUTCFullYear();
  const anniversary = new Date(hire);
  anniversary.setUTCFullYear(hire.getUTCFullYear() + years);
  if (anniversary > periodEnd) {
    years -= 1;
  }
  return Math.max(0, years);
}
