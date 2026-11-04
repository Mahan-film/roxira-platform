import { AllowanceTaxTreatment, WageTaxRegime } from '../enums/hr.enum';
import { gregorianToJalali, jalaliMonthDays } from './jalali-period';
import {
  AnnualTaxBracket,
  PayrollYearRates,
} from '../statutory/payroll-rates';

/**
 * Pure payroll engine (no I/O): one employee, one Jalali month.
 *
 * Order of operations:
 *   1. Earnings: base wage and seniority for the calendar days of the month, housing, food (بن),
 *      child and marriage allowance, contract allowances, overtime (+40%), night-shift premium
 *      (35%), holiday work (+40%), eidi. Premium percentages come from the statutory store.
 *   2. Absence: unpaid days deduct the daily share of base + seniority + housing + food.
 *   3. Insurance: gross minus child allowance, eidi and non-insurable allowances, capped at the
 *      yearly ceiling; employee, employer and unemployment shares.
 *   4. Wage tax: cumulative for the year (`cumulativeTax`) on income after the employee insurance
 *      share, exempt allowances, the non-cash ceiling and the eidi ceiling; flat allowances are
 *      taxed apart.
 *   5. Net = gross − employee insurance − wage tax − other deductions.
 *
 * All results are whole rials. Money times a legal rate is exact (`applyRate`), never floating.
 */
export interface PayrollAllowance {
  title: string;
  amount: number;
  insurable: boolean;
  taxTreatment: AllowanceTaxTreatment;
}

/** The employee's earlier months of the same Jalali year at this employer. */
export interface PayrollYearToDate {
  /** Months already on payroll this year. */
  months: number;
  taxableIncome: number;
  /** Tax already withheld on progressive income (flat tax excluded). */
  progressiveTax: number;
  nonCash: number;
  eidi: number;
}

export interface PayrollInput {
  rates: PayrollYearRates;
  /** Contract monthly base wage (on the statutory day basis). */
  monthlyBaseWage: number;
  housingAllowance: number;
  foodAllowance: number;
  /** Child allowance override from the contract; `null`/0 → derived from `children`. */
  childAllowanceOverride?: number | null;
  children: number;
  married?: boolean;
  /** Full years of service at the end of the period. */
  seniorityYears: number;
  /**
   * Seniority base (paye sanavat) in paye-days for this month, from `seniorityDayUnits`: each day counts
   * the years completed on that day, so a worker whose anniversary falls mid-month is paid from that
   * day. When absent the whole month is paid at `seniorityYears`.
   */
  seniorityDayUnits?: number;
  /** Calendar days of the Jalali month; defaults to the statutory day basis. */
  monthDays?: number;
  allowances?: ReadonlyArray<PayrollAllowance>;
  eidi?: number;
  overtimeHours?: number;
  /** Overtime already priced in rials (legacy single-payslip endpoint). */
  fixedOvertimeAmount?: number;
  nightHours?: number;
  holidayHours?: number;
  absenceDays?: number;
  otherDeductions?: number;
  /** Contract is subject to social-security premium. */
  insuranceSubject?: boolean;
  taxRegime?: WageTaxRegime;
  yearToDate?: PayrollYearToDate;
  /** Contract's own employee insurance rate, as a decimal string. */
  employeeInsuranceRate?: string;
}

export interface PayrollResult {
  baseWage: number;
  seniorityAmount: number;
  housingAllowance: number;
  foodAllowance: number;
  childAllowance: number;
  marriageAllowance: number;
  allowancesTotal: number;
  allowanceLines: PayrollAllowance[];
  eidiAmount: number;
  nonCashAmount: number;
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
  /** Income of this month that joins the cumulative progressive base. */
  taxableIncome: number;
  /** Withheld this month: progressive plus flat. */
  incomeTax: number;
  flatTax: number;
  otherDeductions: number;
  netPay: number;
  monthDays: number;
  /** Paid days in the month (calendar days − absence), used by the insurance list. */
  workDays: number;
  /** Daily wage (base + seniority) / days, used by the insurance list. */
  dailyWage: number;
}

const rial = (value: number): number => Math.round(value);

const nonNegative = (value: number | undefined): number =>
  Math.max(0, Number(value ?? 0) || 0);

const RATE_SCALE = 1_000_000n;

/** Decimal string → parts per million, exactly. */
function ratePpm(rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  return (
    BigInt(whole) * RATE_SCALE +
    BigInt(fraction.padEnd(6, '0').slice(0, 6))
  );
}

/** a / b rounded half up, for non-negative a and positive b. */
const divideHalfUp = (a: bigint, b: bigint): bigint => (2n * a + b) / (2n * b);

/** Whole rials × a decimal-string rate, rounded half up, without floating point. */
export function applyRate(amount: number, rate: string): number {
  return Number(divideHalfUp(BigInt(rial(amount)) * ratePpm(rate), RATE_SCALE));
}

/**
 * Tax due on cumulative income after `months` months: each annual band scaled to m/12, as in the
 * research report's formula. Twelve is multiplied through so no fraction of a rial is ever lost.
 */
export function cumulativeBandTax(
  cumulativeIncome: number,
  months: number,
  brackets: ReadonlyArray<AnnualTaxBracket>,
): number {
  const income12 = BigInt(rial(cumulativeIncome)) * 12n;
  const m = BigInt(months);
  let lower = 0n;
  let due = 0n;
  for (const band of brackets) {
    const upper = band.upTo === null ? null : BigInt(band.upTo) * m;
    const top = upper === null || income12 < upper ? income12 : upper;
    if (top > lower) {
      due += (top - lower) * ratePpm(band.rate);
    }
    if (upper === null) {
      break;
    }
    lower = upper;
  }
  return Number(divideHalfUp(due, 12n * RATE_SCALE));
}

/** This month's withholding: tax due to date less tax already withheld, never negative. */
export function cumulativeTax(
  cumulativeIncome: number,
  months: number,
  brackets: ReadonlyArray<AnnualTaxBracket>,
  alreadyWithheld: number,
): number {
  return Math.max(
    0,
    cumulativeBandTax(cumulativeIncome, months, brackets) - alreadyWithheld,
  );
}

/** Flat regime: one rate above the exemption (first band), with the same cumulative mechanics. */
function flatRegimeBrackets(
  brackets: ReadonlyArray<AnnualTaxBracket>,
  rate: string,
): AnnualTaxBracket[] {
  return [brackets[0], { upTo: null, rate }];
}

function requireFlatRate(rates: PayrollYearRates): string {
  if (rates.flatTaxRate === null) {
    throw new Error(`wage_flat_tax_rate is not configured for ${rates.year}`);
  }
  return rates.flatTaxRate;
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const { rates } = input;
  const basis = rates.payrollMonthDays;
  const monthDays = input.monthDays ?? basis;

  const monthlyBase = nonNegative(input.monthlyBaseWage);
  const seniorityMonthly =
    Math.floor(nonNegative(input.seniorityYears)) * rates.seniorityPerYear;
  const baseWage = rial((monthlyBase * monthDays) / basis);
  const seniorityAmount =
    input.seniorityDayUnits === undefined
      ? rial((seniorityMonthly * monthDays) / basis)
      : rial(
          Math.floor(nonNegative(input.seniorityDayUnits)) *
            (rates.seniorityPerYear / basis),
        );
  const housingAllowance = rial(nonNegative(input.housingAllowance));
  const foodAllowance = rial(nonNegative(input.foodAllowance));
  const override = nonNegative(input.childAllowanceOverride ?? 0);
  const childAllowance = rial(
    override > 0
      ? override
      : Math.floor(nonNegative(input.children)) * rates.childAllowancePerChild,
  );
  const marriageAllowance = input.married ? rates.marriageAllowance : 0;

  const allowanceLines = (input.allowances ?? []).map((line) => ({
    ...line,
    amount: rial(nonNegative(line.amount)),
  }));
  const sumLines = (keep: (line: PayrollAllowance) => boolean): number =>
    allowanceLines.filter(keep).reduce((sum, line) => sum + line.amount, 0);
  const allowancesTotal = sumLines(() => true);
  const eidiAmount = rial(nonNegative(input.eidi));

  const hourlyBase = (monthlyBase + seniorityMonthly) / rates.monthlyWorkHours;
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

  const absenceDays = Math.min(monthDays, nonNegative(input.absenceDays));
  const absenceDeduction = rial(
    ((monthlyBase + seniorityMonthly + housingAllowance + foodAllowance) /
      basis) *
      absenceDays,
  );

  const grossPay = rial(
    baseWage +
      seniorityAmount +
      housingAllowance +
      foodAllowance +
      childAllowance +
      marriageAllowance +
      allowancesTotal +
      eidiAmount +
      overtimeAmount +
      nightShiftAmount +
      holidayAmount -
      absenceDeduction,
  );

  const insuranceSubject = input.insuranceSubject ?? true;
  const nonInsurable =
    childAllowance + eidiAmount + sumLines((line) => !line.insurable);
  const insurableWage = insuranceSubject
    ? rial(
        Math.min(
          Math.max(0, grossPay - nonInsurable),
          rates.maxInsurableMonthlyWage,
        ),
      )
    : 0;
  const { insuranceRates } = rates;
  const employeeInsurance = applyRate(
    insurableWage,
    input.employeeInsuranceRate ?? insuranceRates.employee,
  );
  const employerInsurance = applyRate(insurableWage, insuranceRates.employer);
  const unemploymentInsurance = applyRate(
    insurableWage,
    insuranceRates.unemployment,
  );

  const ytd: PayrollYearToDate = input.yearToDate ?? {
    months: 0,
    taxableIncome: 0,
    progressiveTax: 0,
    nonCash: 0,
    eidi: 0,
  };
  const flatBase = sumLines((l) => l.taxTreatment === AllowanceTaxTreatment.FLAT);
  const exemptBase = sumLines((l) => l.taxTreatment === AllowanceTaxTreatment.EXEMPT);
  const nonCashAmount = sumLines(
    (l) => l.taxTreatment === AllowanceTaxTreatment.NON_CASH,
  );
  const remaining = (ceiling: number | null, used: number): number =>
    Math.max(0, (ceiling ?? 0) - used);
  const nonCashExempt = Math.min(
    nonCashAmount,
    remaining(rates.nonCashExemptAnnual, ytd.nonCash),
  );
  const eidiExempt = Math.min(
    eidiAmount,
    remaining(rates.eidiExemptCeiling, ytd.eidi),
  );

  const taxableIncome = Math.max(
    0,
    grossPay -
      employeeInsurance -
      flatBase -
      exemptBase -
      nonCashExempt -
      eidiExempt,
  );
  const months = ytd.months + 1;
  const flatRegime = input.taxRegime === WageTaxRegime.FLAT;
  const progressive = cumulativeTax(
    ytd.taxableIncome + taxableIncome,
    months,
    flatRegime
      ? flatRegimeBrackets(rates.annualTaxBrackets, requireFlatRate(rates))
      : rates.annualTaxBrackets,
    ytd.progressiveTax,
  );
  const flatTax =
    flatBase > 0 ? applyRate(flatBase, requireFlatRate(rates)) : 0;
  const incomeTax = progressive + flatTax;
  const otherDeductions = rial(nonNegative(input.otherDeductions));
  const netPay = grossPay - employeeInsurance - incomeTax - otherDeductions;

  return {
    baseWage,
    seniorityAmount,
    housingAllowance,
    foodAllowance,
    childAllowance,
    marriageAllowance,
    allowancesTotal,
    allowanceLines,
    eidiAmount,
    nonCashAmount,
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
    flatTax,
    otherDeductions,
    netPay,
    monthDays,
    workDays: monthDays - absenceDays,
    dailyWage: rial((baseWage + seniorityAmount) / monthDays),
  };
}
/** Year-to-date figures from an employee's issued payslips of earlier months. */
export function yearToDateOf(
  slips: ReadonlyArray<{
    taxableIncome: number;
    incomeTax: number;
    flatTax: number;
    nonCashAmount: number;
    eidiAmount: number;
  }>,
): PayrollYearToDate {
  const sum = (value: (slip: (typeof slips)[number]) => number): number =>
    slips.reduce((total, slip) => total + Number(value(slip) ?? 0), 0);
  return {
    months: slips.length,
    taxableIncome: sum((slip) => slip.taxableIncome),
    progressiveTax: sum((slip) => slip.incomeTax) - sum((slip) => slip.flatTax),
    nonCash: sum((slip) => slip.nonCashAmount),
    eidi: sum((slip) => slip.eidiAmount),
  };
}

/**
 * Paye-days of seniority base inside one Jalali month. The 1405 circular 6682 art. 2 pays the daily base
 * once a worker has one year of service or one year has passed since the last base was received, so
 * each completed Jalali year adds one base. Counted per day; Jalali anniversaries, not Gregorian.
 */
export function seniorityDayUnits(
  hireDate: string | null | undefined,
  year: number,
  month: number,
): number {
  const hire = gregorianToJalali(hireDate);
  if (!hire) {
    return 0;
  }
  let units = 0;
  const days = jalaliMonthDays(year, month);
  for (let day = 1; day <= days; day += 1) {
    // A 30 Esfand hire date has no anniversary in a 29-day Esfand: it falls on the last day.
    const anniversaryDay = hire.jm === month ? Math.min(hire.jd, days) : hire.jd;
    const beforeAnniversary =
      month < hire.jm || (month === hire.jm && day < anniversaryDay);
    const completed = year - hire.jy - (beforeAnniversary ? 1 : 0);
    units += Math.max(0, completed);
  }
  return units;
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
