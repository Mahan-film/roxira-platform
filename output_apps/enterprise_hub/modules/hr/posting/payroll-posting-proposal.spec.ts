import { buildProposal } from '../../posting_rules/domain/posting-engine';
import { PostingRuleError } from '../../posting_rules/domain/posting-error';
import {
  payrollPayslipProposalInput,
  payrollRunProposalInput,
  type PayrollPayslipTotals,
  type PayrollRunTotals,
} from './payroll-posting-proposal';

/** A run that pays gross and deducts employee insurance + wage tax, everything else zero. */
const runWithDeductions: PayrollRunTotals = {
  totalGross: 10_000n,
  totalEmployeeInsurance: 700n,
  totalEmployerInsurance: 2_000n,
  totalUnemploymentInsurance: 300n,
  totalIncomeTax: 500n,
  totalOtherDeductions: 0n,
  totalNet: 8_800n,
};

/** A run with no deductions at all: net pay equals gross, employer cost is zero. */
const runWithoutDeductions: PayrollRunTotals = {
  totalGross: 5_000n,
  totalEmployeeInsurance: 0n,
  totalEmployerInsurance: 0n,
  totalUnemploymentInsurance: 0n,
  totalIncomeTax: 0n,
  totalOtherDeductions: 0n,
  totalNet: 5_000n,
};

const payslipWithDeductions: PayrollPayslipTotals = {
  grossPay: 10_000n,
  insuranceDeduction: 700n,
  incomeTax: 500n,
  otherDeductions: 300n,
  netPay: 8_500n,
};

describe('payrollRunProposalInput', () => {
  it('maps a run with deductions to a balanced payroll.run voucher on the legacy accounts', () => {
    const proposal = buildProposal(payrollRunProposalInput(runWithDeductions)!);
    expect(proposal.docType).toBe('payroll.run');
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['5010', 10_000n, 0n],
      ['5040', 2_300n, 0n],
      ['2030', 0n, 3_000n],
      ['2040', 0n, 500n],
      ['2050', 0n, 8_800n],
    ]);
    const debit = proposal.lines.reduce((sum, l) => sum + l.debit, 0n);
    const credit = proposal.lines.reduce((sum, l) => sum + l.credit, 0n);
    expect(debit).toBe(credit);
    expect(proposal.total).toBe(debit);
  });

  it('maps a run without deductions to a balanced voucher with no zero lines', () => {
    const proposal = buildProposal(payrollRunProposalInput(runWithoutDeductions)!);
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['5010', 5_000n, 0n],
      ['2050', 0n, 5_000n],
    ]);
    expect(proposal.total).toBe(5_000n);
  });

  it('returns null for a zero-pay run so nothing is posted', () => {
    const zeroRun: PayrollRunTotals = {
      totalGross: 0n,
      totalEmployeeInsurance: 0n,
      totalEmployerInsurance: 0n,
      totalUnemploymentInsurance: 0n,
      totalIncomeTax: 0n,
      totalOtherDeductions: 0n,
      totalNet: 0n,
    };
    expect(payrollRunProposalInput(zeroRun)).toBeNull();
  });

  it('refuses a mapped run whose totals do not balance', () => {
    const unbalanced = { ...runWithDeductions, totalNet: 8_799n };
    try {
      buildProposal(payrollRunProposalInput(unbalanced)!);
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PostingRuleError);
      expect((e as PostingRuleError).code).toBe('UNBALANCED');
    }
  });

  it('passes a negative total through so buildProposal refuses it', () => {
    const negative = { ...runWithoutDeductions, totalGross: -1n, totalNet: -1n };
    try {
      buildProposal(payrollRunProposalInput(negative)!);
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PostingRuleError);
      expect((e as PostingRuleError).code).toBe('NEGATIVE_AMOUNT');
    }
  });
});

describe('payrollPayslipProposalInput', () => {
  it('maps a payslip with deductions to a balanced payroll.payslip voucher', () => {
    const proposal = buildProposal(payrollPayslipProposalInput(payslipWithDeductions)!);
    expect(proposal.docType).toBe('payroll.payslip');
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['5010', 10_000n, 0n],
      ['2010', 0n, 1_500n],
      ['1010', 0n, 8_500n],
    ]);
    const debit = proposal.lines.reduce((sum, l) => sum + l.debit, 0n);
    const credit = proposal.lines.reduce((sum, l) => sum + l.credit, 0n);
    expect(debit).toBe(credit);
  });

  it('binds the deductions amount to the payroll_payable role, not the bank role', () => {
    const input = payrollPayslipProposalInput(payslipWithDeductions)!;
    // Mapping keys are posting roles; the template maps amount 'deductions' -> role
    // 'payroll_payable' (2010) and amount 'net' -> role 'bank' (1010).
    expect(input.mapping).toMatchObject({ payroll_payable: '2010', bank: '1010' });
    const proposal = buildProposal(input);
    const payable = proposal.lines.find((l) => l.role === 'payroll_payable')!;
    expect([payable.accountCode, payable.credit]).toEqual(['2010', 1_500n]);
    const bank = proposal.lines.find((l) => l.role === 'bank')!;
    expect([bank.accountCode, bank.credit]).toEqual(['1010', 8_500n]);
  });

  it('drops the zero deductions line for a payslip without deductions', () => {
    const noDeductions: PayrollPayslipTotals = {
      grossPay: 5_000n,
      insuranceDeduction: 0n,
      incomeTax: 0n,
      otherDeductions: 0n,
      netPay: 5_000n,
    };
    const proposal = buildProposal(payrollPayslipProposalInput(noDeductions)!);
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['5010', 5_000n, 0n],
      ['1010', 0n, 5_000n],
    ]);
  });

  it('drops the net line for a fully deducted (zero net pay) employee', () => {
    const zeroNet: PayrollPayslipTotals = {
      grossPay: 1_000n,
      insuranceDeduction: 1_000n,
      incomeTax: 0n,
      otherDeductions: 0n,
      netPay: 0n,
    };
    const proposal = buildProposal(payrollPayslipProposalInput(zeroNet)!);
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['5010', 1_000n, 0n],
      ['2010', 0n, 1_000n],
    ]);
  });

  it('returns null for a zero-pay employee so no line is produced', () => {
    const zeroPayslip: PayrollPayslipTotals = {
      grossPay: 0n,
      insuranceDeduction: 0n,
      incomeTax: 0n,
      otherDeductions: 0n,
      netPay: 0n,
    };
    expect(payrollPayslipProposalInput(zeroPayslip)).toBeNull();
  });
});
