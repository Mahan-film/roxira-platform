/**
 * Pure mapper from payroll totals (integer rials) to a `buildProposal` input for the
 * `payroll.run` and `payroll.payslip` documents. No I/O and no module wiring: a caller passes
 * the persisted totals and feeds the result to `buildProposal`, which owns validation,
 * zero-line dropping and the debit/credit balance check.
 *
 * Account codes come from `hr.constants` so the adopting posting templates and the HR module
 * post to the same chart accounts. Amounts stay in integer bigint rials — no floating point.
 */
import type { BuildInput, RoleAccounts } from '../../posting_rules/domain/posting-engine';
import {
  PAYROLL_BANK_ACCOUNT_CODE,
  PAYROLL_EXPENSE_ACCOUNT_CODE,
  PAYROLL_PAYABLE_ACCOUNT_CODE,
  PAYROLL_RUN_ACCOUNTS,
} from '../constants/hr.constants';

/** Totals of one monthly payroll run (the run's persisted columns), in integer rials. */
export interface PayrollRunTotals {
  totalGross: bigint;
  totalEmployeeInsurance: bigint;
  totalEmployerInsurance: bigint;
  totalUnemploymentInsurance: bigint;
  totalIncomeTax: bigint;
  totalOtherDeductions: bigint;
  totalNet: bigint;
}

/** Totals of one employee's payslip (the payslip's persisted columns), in integer rials. */
export interface PayrollPayslipTotals {
  grossPay: bigint;
  insuranceDeduction: bigint;
  incomeTax: bigint;
  otherDeductions: bigint;
  netPay: bigint;
}

/** Role -> account of the monthly run voucher (matches PAYROLL_RUN_ACCOUNTS). */
const RUN_ROLE_ACCOUNTS: RoleAccounts = {
  payroll_expense: PAYROLL_RUN_ACCOUNTS.salaryExpense.code,
  employer_insurance_expense: PAYROLL_RUN_ACCOUNTS.employerInsuranceExpense.code,
  insurance_payable: PAYROLL_RUN_ACCOUNTS.insurancePayable.code,
  wage_tax_payable: PAYROLL_RUN_ACCOUNTS.wageTaxPayable.code,
  other_deductions_payable: PAYROLL_RUN_ACCOUNTS.otherDeductionsPayable.code,
  payroll_payable: PAYROLL_RUN_ACCOUNTS.salariesPayable.code,
};

/** Role -> account of a payslip voucher (matches the HR single-payslip codes). */
const PAYSLIP_ROLE_ACCOUNTS: RoleAccounts = {
  payroll_expense: PAYROLL_EXPENSE_ACCOUNT_CODE,
  payroll_payable: PAYROLL_PAYABLE_ACCOUNT_CODE,
  bank: PAYROLL_BANK_ACCOUNT_CODE,
};

/** True when every amount is exactly zero (nothing to post; a zero-pay run/payslip). */
function allZero(amounts: Readonly<Record<string, bigint>>): boolean {
  return Object.values(amounts).every((value) => value === 0n);
}

/**
 * Maps a monthly payroll run's totals to a `buildProposal` input. The run voucher posts gross
 * salaries plus the employer cost as debits; insurance (employee + employer + unemployment),
 * wage tax, other deductions and net pay as credits. Returns null for a zero-pay run so the
 * caller posts nothing (the engine would otherwise refuse an empty voucher).
 */
export function payrollRunProposalInput(run: PayrollRunTotals): BuildInput | null {
  const employerCost = run.totalEmployerInsurance + run.totalUnemploymentInsurance;
  const insurance = run.totalEmployeeInsurance + employerCost;
  const amounts = {
    gross: run.totalGross,
    employerCost,
    insurance,
    incomeTax: run.totalIncomeTax,
    otherDeductions: run.totalOtherDeductions,
    net: run.totalNet,
  };
  if (allZero(amounts)) return null;
  return { docType: 'payroll.run', amounts, mapping: RUN_ROLE_ACCOUNTS };
}

/**
 * Maps one employee's payslip totals to a `buildProposal` input. The payslip voucher debits the
 * gross salary and credits the payable deductions (insurance + tax + other) and the net pay.
 * Returns null for a zero-pay employee so no line is posted for them.
 */
export function payrollPayslipProposalInput(payslip: PayrollPayslipTotals): BuildInput | null {
  const deductions = payslip.insuranceDeduction + payslip.incomeTax + payslip.otherDeductions;
  const amounts = {
    gross: payslip.grossPay,
    deductions,
    net: payslip.netPay,
  };
  if (allZero(amounts)) return null;
  return { docType: 'payroll.payslip', amounts, mapping: PAYSLIP_ROLE_ACCOUNTS };
}
