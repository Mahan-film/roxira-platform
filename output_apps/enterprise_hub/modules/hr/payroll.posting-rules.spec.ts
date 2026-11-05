import { toMinor } from '../accounting/money';
import { buildProposal } from '../posting_rules/domain/posting-engine';
import {
  payrollPayslipProposalInput,
  payrollRunProposalInput,
  PayrollPayslipTotals,
  PayrollRunTotals,
} from './posting/payroll-posting-proposal';
import {
  LegacyPayslipTotals,
  LegacyRunTotals,
  legacyPayslipLines,
  legacyRunLines,
} from './__fixtures__/legacy-payroll-posting';

/**
 * Old vs new: the posting rules engine, resolved with the template/global defaults (no tenant
 * mapping, no overrides), must give the same payroll vouchers as the hardcoded lines it replaced
 * (frozen in __fixtures__/legacy-payroll-posting.ts) for every amount shape.
 */

/** Engine lines and legacy lines reduced to the comparable shape (accounts, sides, amounts, order). */
const engineLines = (proposal: ReturnType<typeof buildProposal>) =>
  proposal.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.debit,
    credit: l.credit,
  }));

const legacyToMinor = (lines: ReturnType<typeof legacyRunLines>) =>
  lines.map((l) => ({
    accountCode: l.accountCode,
    debit: toMinor(l.debit ?? 0),
    credit: toMinor(l.credit ?? 0),
  }));

type RunCase = {
  gross: number;
  employeeInsurance: number;
  employerInsurance: number;
  unemployment: number;
  tax: number;
  other: number;
};

/** A balanced run: net is whatever is left after employee insurance, wage tax and deductions. */
const runTotals = (t: RunCase): PayrollRunTotals => ({
  totalGross: toMinor(t.gross),
  totalEmployeeInsurance: toMinor(t.employeeInsurance),
  totalEmployerInsurance: toMinor(t.employerInsurance),
  totalUnemploymentInsurance: toMinor(t.unemployment),
  totalIncomeTax: toMinor(t.tax),
  totalOtherDeductions: toMinor(t.other),
  totalNet: toMinor(t.gross - t.employeeInsurance - t.tax - t.other),
});

const runLegacy = (t: RunCase): LegacyRunTotals => ({
  totalGross: t.gross,
  totalEmployeeInsurance: t.employeeInsurance,
  totalEmployerInsurance: t.employerInsurance,
  totalUnemploymentInsurance: t.unemployment,
  totalIncomeTax: t.tax,
  totalOtherDeductions: t.other,
  totalNet: t.gross - t.employeeInsurance - t.tax - t.other,
});

const RUN_CASES: RunCase[] = [
  { gross: 10000, employeeInsurance: 700, employerInsurance: 2300, unemployment: 0, tax: 300, other: 500 },
  { gross: 10000, employeeInsurance: 700, employerInsurance: 2000, unemployment: 300, tax: 300, other: 500 },
  { gross: 10000, employeeInsurance: 700, employerInsurance: 0, unemployment: 0, tax: 0, other: 0 },
  { gross: 500_000_000, employeeInsurance: 35_000_000, employerInsurance: 0, unemployment: 0, tax: 1_000_000, other: 0 },
  { gross: 1000, employeeInsurance: 400, employerInsurance: 0, unemployment: 0, tax: 600, other: 0 },
  { gross: 2000, employeeInsurance: 100, employerInsurance: 50, unemployment: 10, tax: 0, other: 200 },
  { gross: 1, employeeInsurance: 0, employerInsurance: 0, unemployment: 0, tax: 0, other: 0 },
];

type PayslipCase = { gross: number; insurance: number; tax: number; other: number };

const payslipTotals = (t: PayslipCase): PayrollPayslipTotals => ({
  grossPay: toMinor(t.gross),
  insuranceDeduction: toMinor(t.insurance),
  incomeTax: toMinor(t.tax),
  otherDeductions: toMinor(t.other),
  netPay: toMinor(t.gross - t.insurance - t.tax - t.other),
});

const payslipLegacy = (t: PayslipCase): LegacyPayslipTotals => ({
  grossPay: t.gross,
  insuranceDeduction: t.insurance,
  incomeTax: t.tax,
  otherDeductions: t.other,
  netPay: t.gross - t.insurance - t.tax - t.other,
});

const PAYSLIP_CASES: PayslipCase[] = [
  { gross: 10000, insurance: 700, tax: 300, other: 200 },
  { gross: 10000, insurance: 0, tax: 0, other: 0 },
  { gross: 5000, insurance: 500, tax: 0, other: 0 },
  { gross: 3000, insurance: 1000, tax: 500, other: 1500 },
  { gross: 400_000_000, insurance: 28_000_000, tax: 4_000_000, other: 1_000_000 },
  { gross: 1, insurance: 0, tax: 0, other: 0 },
];

describe('payroll postings: legacy lines vs posting rules engine defaults', () => {
  it('run vouchers are identical (accounts, sides, amounts, order)', () => {
    for (const c of RUN_CASES) {
      const proposal = buildProposal({
        docType: 'payroll.run',
        amounts: payrollRunProposalInput(runTotals(c))!.amounts,
      });
      expect(engineLines(proposal)).toEqual(legacyToMinor(legacyRunLines(runLegacy(c))));
    }
  });

  it('payslip vouchers are identical (accounts, sides, amounts, order)', () => {
    for (const c of PAYSLIP_CASES) {
      const proposal = buildProposal({
        docType: 'payroll.payslip',
        amounts: payrollPayslipProposalInput(payslipTotals(c))!.amounts,
      });
      expect(engineLines(proposal)).toEqual(legacyToMinor(legacyPayslipLines(payslipLegacy(c))));
    }
  });
});
