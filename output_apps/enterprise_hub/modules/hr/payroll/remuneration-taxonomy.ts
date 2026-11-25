/**
 * Canonical remuneration taxonomy for Roxira's bitemporal payroll kernel (T260 / #1055, R24).
 *
 * Design invariants:
 * - All monetary amounts are integer minor units (`bigint`). Never use JS floats or `Number()`.
 * - Statutory rates, ceilings, and brackets are NEVER hardcoded here; they live in
 *   effective-dated configuration tables activated via four-eyes approval.
 * - Country packs map their local wage types to these canonical component codes.
 */

export enum RemunerationCategory {
  EARNING = 'EARNING',
  BENEFIT_IN_KIND = 'BENEFIT_IN_KIND',
  EMPLOYEE_DEDUCTION = 'EMPLOYEE_DEDUCTION',
  STATUTORY_TAX = 'STATUTORY_TAX',
  STATUTORY_SOCIAL_INSURANCE_EMPLOYEE = 'STATUTORY_SOCIAL_INSURANCE_EMPLOYEE',
  STATUTORY_SOCIAL_INSURANCE_EMPLOYER = 'STATUTORY_SOCIAL_INSURANCE_EMPLOYER',
  EMPLOYER_CONTRIBUTION = 'EMPLOYER_CONTRIBUTION',
  NET_ADJUSTMENT = 'NET_ADJUSTMENT',
  RETRO_DELTA = 'RETRO_DELTA',
}

export enum CanonicalRemunerationCode {
  BASE_SALARY = 'BASE_SALARY',
  HOUSING_ALLOWANCE = 'HOUSING_ALLOWANCE',
  GROCERY_ALLOWANCE = 'GROCERY_ALLOWANCE',
  CHILD_ALLOWANCE = 'CHILD_ALLOWANCE',
  MARRIAGE_ALLOWANCE = 'MARRIAGE_ALLOWANCE',
  SENIORITY_PAY = 'SENIORITY_PAY',
  OVERTIME = 'OVERTIME',
  SHIFT_DIFFERENTIAL = 'SHIFT_DIFFERENTIAL',
  BONUS = 'BONUS',
  COMMISSION = 'COMMISSION',
  BIK_VEHICLE = 'BIK_VEHICLE',
  BIK_HOUSING = 'BIK_HOUSING',
  LOAN_REPAYMENT = 'LOAN_REPAYMENT',
  ADVANCE_RECOVERY = 'ADVANCE_RECOVERY',
  GARNISHMENT = 'GARNISHMENT',
  INCOME_TAX = 'INCOME_TAX',
  SOCIAL_INSURANCE_EMPLOYEE = 'SOCIAL_INSURANCE_EMPLOYEE',
  SOCIAL_INSURANCE_EMPLOYER = 'SOCIAL_INSURANCE_EMPLOYER',
  UNEMPLOYMENT_INSURANCE_EMPLOYER = 'UNEMPLOYMENT_INSURANCE_EMPLOYER',
  END_OF_SERVICE_ACCRUAL = 'END_OF_SERVICE_ACCRUAL',
  RETRO_EARNING_DELTA = 'RETRO_EARNING_DELTA',
  RETRO_DEDUCTION_DELTA = 'RETRO_DEDUCTION_DELTA',
}

export type PayrollGlRole =
  | 'salary_expense'
  | 'employer_insurance_expense'
  | 'end_of_service_expense'
  | 'payroll_payable'
  | 'tax_payable'
  | 'insurance_payable'
  | 'employee_loans_receivable'
  | 'end_of_service_provision';

/**
 * Effective-dated definition of a pay component inside a country pack.
 * Does NOT embed statutory rates or ceilings.
 */
export interface RemunerationComponentSpec {
  readonly code: CanonicalRemunerationCode;
  readonly category: RemunerationCategory;
  /** Local display label for the pack (e.g. default pack label). */
  readonly label: string;
  /** Inclusive ISO calendar date (YYYY-MM-DD) when this definition takes effect. */
  readonly effectiveFrom: string;
  /** Optional inclusive ISO calendar date (YYYY-MM-DD) when this definition ends. */
  readonly effectiveTo: string | null;
  /** Whether the component enters the taxable wage base (pack rules apply caps). */
  readonly taxable: boolean;
  /** Whether the component enters the social-insurance wage base. */
  readonly insurable: boolean;
  /** Whether the component is paid in cash to the employee (false for BIK / employer accruals). */
  readonly cashPayable: boolean;
  /**
   * Deduction priority waterfall rank (lower = deducted first; 0 for non-deductions).
   * Statutory withholdings always precede voluntary loans and garnishments.
   */
  readonly deductionPriority: number;
  /** Target GL posting role for automated payroll journal entries. */
  readonly glRole: PayrollGlRole;
}

/**
 * Bitemporal payslip line item produced by a payroll calculation or retro-delta pass.
 */
export interface RemunerationLineItem {
  readonly componentCode: CanonicalRemunerationCode;
  readonly category: RemunerationCategory;
  /** Signed integer minor units (`bigint`). Retro deltas may be negative or positive. */
  readonly amountMinor: bigint;
  /** ISO-4217 currency code (e.g. 'IRR', 'EUR'). */
  readonly currency: string;
  /** Bitemporal valid-time start (ISO date YYYY-MM-DD). */
  readonly validFrom: string;
  /** Bitemporal valid-time end (ISO date YYYY-MM-DD). */
  readonly validTo: string;
  /** Bitemporal recorded-time timestamp (ISO-8601 UTC). */
  readonly recordedAt: string;
  /** Optional cost-centre or branch allocation tag. */
  readonly costCenterCode?: string | null;
  readonly branchId?: string | null;
  /** Reference to the original closed payrun id when `category === RETRO_DELTA`. */
  readonly retroSourcePayrunId?: string | null;
}

export interface RemunerationSummary {
  readonly currency: string;
  readonly grossEarningsMinor: bigint;
  readonly benefitsInKindMinor: bigint;
  readonly totalEmployeeDeductionsMinor: bigint;
  readonly totalEmployerContributionsMinor: bigint;
  readonly retroDeltaMinor: bigint;
  readonly netPayMinor: bigint;
}

const EMPLOYEE_DEDUCTION_CATEGORIES: ReadonlySet<RemunerationCategory> = new Set([
  RemunerationCategory.EMPLOYEE_DEDUCTION,
  RemunerationCategory.STATUTORY_TAX,
  RemunerationCategory.STATUTORY_SOCIAL_INSURANCE_EMPLOYEE,
]);

const EMPLOYER_CONTRIBUTION_CATEGORIES: ReadonlySet<RemunerationCategory> = new Set([
  RemunerationCategory.STATUTORY_SOCIAL_INSURANCE_EMPLOYER,
  RemunerationCategory.EMPLOYER_CONTRIBUTION,
]);

/**
 * Aggregates a single employee's payslip lines in exact `bigint` minor units.
 * Enforces single-currency consistency and rejects negative non-retro/non-adjustment lines.
 */
export function summarizeRemunerationLines(
  lines: readonly RemunerationLineItem[],
  expectedCurrency?: string,
): RemunerationSummary {
  if (lines.length === 0) {
    return {
      currency: expectedCurrency ?? 'IRR',
      grossEarningsMinor: 0n,
      benefitsInKindMinor: 0n,
      totalEmployeeDeductionsMinor: 0n,
      totalEmployerContributionsMinor: 0n,
      retroDeltaMinor: 0n,
      netPayMinor: 0n,
    };
  }

  const currency = expectedCurrency ?? lines[0].currency;
  let grossEarningsMinor = 0n;
  let benefitsInKindMinor = 0n;
  let totalEmployeeDeductionsMinor = 0n;
  let totalEmployerContributionsMinor = 0n;
  let retroDeltaMinor = 0n;
  let netAdjustmentMinor = 0n;

  for (const line of lines) {
    if (line.currency !== currency) {
      throw new Error(
        `Mixed currencies in remuneration lines: expected ${currency}, got ${line.currency} (${line.componentCode}).`,
      );
    }

    if (line.category === RemunerationCategory.EARNING) {
      if (line.amountMinor < 0n) {
        throw new Error(`Negative EARNING line is not allowed (${line.componentCode}); use RETRO_DELTA.`);
      }
      grossEarningsMinor += line.amountMinor;
    } else if (line.category === RemunerationCategory.BENEFIT_IN_KIND) {
      if (line.amountMinor < 0n) {
        throw new Error(`Negative BENEFIT_IN_KIND line is not allowed (${line.componentCode}).`);
      }
      benefitsInKindMinor += line.amountMinor;
    } else if (EMPLOYEE_DEDUCTION_CATEGORIES.has(line.category)) {
      if (line.amountMinor < 0n) {
        throw new Error(`Negative employee deduction line is not allowed (${line.componentCode}); use RETRO_DELTA.`);
      }
      totalEmployeeDeductionsMinor += line.amountMinor;
    } else if (EMPLOYER_CONTRIBUTION_CATEGORIES.has(line.category)) {
      if (line.amountMinor < 0n) {
        throw new Error(`Negative employer contribution line is not allowed (${line.componentCode}).`);
      }
      totalEmployerContributionsMinor += line.amountMinor;
    } else if (line.category === RemunerationCategory.RETRO_DELTA) {
      retroDeltaMinor += line.amountMinor;
    } else if (line.category === RemunerationCategory.NET_ADJUSTMENT) {
      netAdjustmentMinor += line.amountMinor;
    }
  }

  const netPayMinor =
    grossEarningsMinor - totalEmployeeDeductionsMinor + retroDeltaMinor + netAdjustmentMinor;

  return {
    currency,
    grossEarningsMinor,
    benefitsInKindMinor,
    totalEmployeeDeductionsMinor,
    totalEmployerContributionsMinor,
    retroDeltaMinor,
    netPayMinor,
  };
}

/**
 * R24 invariant: bank disbursement file total must equal the sum of net payslips
 * to the exact minor unit (`bigint`).
 */
export function assertBankTotalMatchesPayslips(
  payslipNetTotalsMinor: readonly bigint[],
  bankFileTotalMinor: bigint,
): void {
  const sum = payslipNetTotalsMinor.reduce((acc, v) => acc + v, 0n);
  if (sum !== bankFileTotalMinor) {
    throw new Error(
      `Bank payment total (${bankFileTotalMinor.toString()}) does not match sum of net payslips (${sum.toString()}).`,
    );
  }
}
