/* Frozen copy of the payroll posting logic before the posting rules engine (#230), kept only to
 * prove the engine posts identical vouchers. Do not edit. */
import {
  PAYROLL_BANK_ACCOUNT_CODE,
  PAYROLL_EXPENSE_ACCOUNT_CODE,
  PAYROLL_PAYABLE_ACCOUNT_CODE,
  PAYROLL_RUN_ACCOUNTS,
} from '../constants/hr.constants';

/** Amounts are decimal rials (legacy scale); the engine speaks integer minor units. */
export interface LegacyPostingLine {
  accountCode: string;
  debit?: number;
  credit?: number;
}

export interface LegacyRunTotals {
  totalGross: number;
  totalEmployeeInsurance: number;
  totalEmployerInsurance: number;
  totalUnemploymentInsurance: number;
  totalIncomeTax: number;
  totalOtherDeductions: number;
  totalNet: number;
}

export interface LegacyPayslipTotals {
  grossPay: number;
  insuranceDeduction: number;
  incomeTax: number;
  otherDeductions: number;
  netPay: number;
}

/** Frozen copy of PayrollRunService.buildJournalLines (rial amounts, zero lines dropped). */
export function legacyRunLines(run: LegacyRunTotals): LegacyPostingLine[] {
  const accounts = PAYROLL_RUN_ACCOUNTS;
  const employerCost =
    run.totalEmployerInsurance + run.totalUnemploymentInsurance;
  const insurance = run.totalEmployeeInsurance + employerCost;
  const lines: LegacyPostingLine[] = [
    { accountCode: accounts.salaryExpense.code, debit: run.totalGross },
    { accountCode: accounts.employerInsuranceExpense.code, debit: employerCost },
    { accountCode: accounts.insurancePayable.code, credit: insurance },
    { accountCode: accounts.wageTaxPayable.code, credit: run.totalIncomeTax },
    {
      accountCode: accounts.otherDeductionsPayable.code,
      credit: run.totalOtherDeductions,
    },
    { accountCode: accounts.salariesPayable.code, credit: run.totalNet },
  ];
  return lines.filter((line) => (line.debit ?? line.credit ?? 0) > 0);
}

/** Frozen copy of the HrService.issuePayslip journal lines (rial amounts, zero lines dropped). */
export function legacyPayslipLines(
  payslip: LegacyPayslipTotals,
): LegacyPostingLine[] {
  const payableTotal =
    payslip.insuranceDeduction + payslip.incomeTax + payslip.otherDeductions;
  const lines: LegacyPostingLine[] = [
    { accountCode: PAYROLL_EXPENSE_ACCOUNT_CODE, debit: payslip.grossPay },
  ];
  if (payableTotal > 0) {
    lines.push({
      accountCode: PAYROLL_PAYABLE_ACCOUNT_CODE,
      credit: payableTotal,
    });
  }
  if (payslip.netPay > 0) {
    lines.push({
      accountCode: PAYROLL_BANK_ACCOUNT_CODE,
      credit: payslip.netPay,
    });
  }
  return lines;
}
