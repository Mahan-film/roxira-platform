/**
 * Posting check of a payroll run (pure). The voucher is built from the run totals; this proves the run totals
 * are the sum of the payslips, each payslip adds up, and every voucher line equals the figure it stands for.
 * Money is integer rials, so every comparison is exact.
 */
export interface ReconPayslip {
  payslipNumber: string;
  grossPay: number;
  insuranceDeduction: number;
  incomeTax: number;
  otherDeductions: number;
  netPay: number;
  employerInsurance: number;
  unemploymentInsurance: number;
}

export interface ReconRunTotals {
  employeeCount: number;
  totalGross: number;
  totalEmployeeInsurance: number;
  totalEmployerInsurance: number;
  totalUnemploymentInsurance: number;
  totalIncomeTax: number;
  totalOtherDeductions: number;
  totalNet: number;
}

export interface ReconLine {
  accountCode: string;
  debit?: number;
  credit?: number;
}

/** Account codes the voucher uses, by role. */
export interface ReconAccounts {
  salaryExpense: string;
  employerInsuranceExpense: string;
  insurancePayable: string;
  wageTaxPayable: string;
  otherDeductionsPayable: string;
  salariesPayable: string;
}

export interface Reconciliation {
  ok: boolean;
  problems: string[];
  debitTotal: number;
  creditTotal: number;
}

const sum = <T>(rows: ReadonlyArray<T>, pick: (row: T) => number): number =>
  rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0);

export function reconcilePayrollRun(
  run: ReconRunTotals,
  payslips: ReadonlyArray<ReconPayslip>,
  lines: ReadonlyArray<ReconLine>,
  accounts: ReconAccounts,
): Reconciliation {
  const problems: string[] = [];
  const expectEqual = (what: string, a: number, b: number): void => {
    if (a !== b) problems.push(`${what}: ${a} != ${b}`);
  };

  expectEqual('employeeCount vs payslips', run.employeeCount, payslips.length);
  expectEqual('totalGross vs payslips', run.totalGross, sum(payslips, (p) => p.grossPay));
  expectEqual('totalNet vs payslips', run.totalNet, sum(payslips, (p) => p.netPay));
  expectEqual('totalIncomeTax vs payslips', run.totalIncomeTax, sum(payslips, (p) => p.incomeTax));
  expectEqual(
    'totalEmployeeInsurance vs payslips',
    run.totalEmployeeInsurance,
    sum(payslips, (p) => p.insuranceDeduction),
  );
  expectEqual(
    'totalEmployerInsurance vs payslips',
    run.totalEmployerInsurance,
    sum(payslips, (p) => p.employerInsurance),
  );
  expectEqual(
    'totalUnemploymentInsurance vs payslips',
    run.totalUnemploymentInsurance,
    sum(payslips, (p) => p.unemploymentInsurance),
  );
  expectEqual(
    'totalOtherDeductions vs payslips',
    run.totalOtherDeductions,
    sum(payslips, (p) => p.otherDeductions),
  );

  for (const p of payslips) {
    const net = p.grossPay - p.insuranceDeduction - p.incomeTax - p.otherDeductions;
    if (net !== p.netPay) {
      problems.push(`${p.payslipNumber}: gross - deductions = ${net} != net ${p.netPay}`);
    }
  }

  const debitTotal = sum(lines, (l) => l.debit ?? 0);
  const creditTotal = sum(lines, (l) => l.credit ?? 0);
  expectEqual('voucher debit vs credit', debitTotal, creditTotal);

  const side = (code: string, key: 'debit' | 'credit'): number =>
    sum(
      lines.filter((l) => l.accountCode === code),
      (l) => l[key] ?? 0,
    );
  const employerCost = run.totalEmployerInsurance + run.totalUnemploymentInsurance;
  expectEqual('salary expense debit vs totalGross', side(accounts.salaryExpense, 'debit'), run.totalGross);
  expectEqual(
    'employer insurance expense debit vs employer + unemployment',
    side(accounts.employerInsuranceExpense, 'debit'),
    employerCost,
  );
  expectEqual(
    'insurance payable credit vs employee + employer + unemployment',
    side(accounts.insurancePayable, 'credit'),
    run.totalEmployeeInsurance + employerCost,
  );
  expectEqual('wage tax payable credit vs totalIncomeTax', side(accounts.wageTaxPayable, 'credit'), run.totalIncomeTax);
  expectEqual(
    'other deductions credit vs totalOtherDeductions',
    side(accounts.otherDeductionsPayable, 'credit'),
    run.totalOtherDeductions,
  );
  expectEqual('salaries payable credit vs totalNet', side(accounts.salariesPayable, 'credit'), run.totalNet);

  const known = new Set(Object.values(accounts));
  for (const line of lines) {
    if (!known.has(line.accountCode)) problems.push(`voucher line on unexpected account ${line.accountCode}`);
  }
  return { ok: problems.length === 0, problems, debitTotal, creditTotal };
}
