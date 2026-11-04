import { formatRial, payslipTable, PayslipPrint } from './services/payslip-pdf';
import { reconcilePayrollRun } from './services/payroll-reconciliation';

const slip: PayslipPrint = {
  payslipNumber: 'PS-140507-001',
  periodYear: 1405,
  periodMonth: 7,
  employeeNumber: 'E-1',
  fullName: 'علی کریمی',
  nationalId: '0012345679',
  insuranceNumber: null,
  jobTitle: 'کارگر',
  workDays: 30,
  baseSalary: 166_255_500,
  seniorityAmount: 10_000_020,
  housingAllowance: 30_000_000,
  foodAllowance: 22_000_000,
  childAllowance: 0,
  marriageAllowance: 0,
  allowancesTotal: 0,
  eidiAmount: 0,
  overtimeAmount: 0,
  nightShiftAmount: 0,
  holidayAmount: 0,
  absenceDeduction: 0,
  grossPay: 228_255_520,
  insuranceDeduction: 15_977_886,
  incomeTax: 0,
  otherDeductions: 0,
  netPay: 212_277_634,
  employerInsurance: 45_651_104,
  unemploymentInsurance: 6_847_666,
};

describe('formatRial', () => {
  it('groups with the Persian separator and Persian digits', () => {
    expect(formatRial(1_234_567)).toBe('۱٬۲۳۴٬۵۶۷');
    expect(formatRial(0)).toBe('۰');
    expect(formatRial(-5000)).toBe('(۵٬۰۰۰)');
  });
});

describe('payslipTable', () => {
  const amounts = (rows: { cells: unknown[] }[]) => new Map(rows.map((r) => [r.cells[0], r.cells[1]]));

  it('prints gross and net as given and leaves zero lines out', () => {
    const table = payslipTable(slip);
    const map = amounts(table.rows);
    expect(table.title).toBe('فیش حقوقی مهر ۱۴۰۵');
    expect(map.get('جمع ناخالص')).toBe(formatRial(slip.grossPay));
    expect(map.get('خالص پرداختی')).toBe(formatRial(slip.netPay));
    expect(map.has('اضافه‌کار')).toBe(false);
    expect(map.get('شماره بیمه')).toBe('—');
  });
});

describe('reconcilePayrollRun', () => {
  const accounts = {
    salaryExpense: '5010',
    employerInsuranceExpense: '5040',
    insurancePayable: '2030',
    wageTaxPayable: '2040',
    otherDeductionsPayable: '2060',
    salariesPayable: '2050',
  };
  const payslip = {
    payslipNumber: 'P1', grossPay: 1000, insuranceDeduction: 70, incomeTax: 30, otherDeductions: 0,
    netPay: 900, employerInsurance: 200, unemploymentInsurance: 30,
  };
  const run = {
    employeeCount: 1, totalGross: 1000, totalEmployeeInsurance: 70, totalEmployerInsurance: 200,
    totalUnemploymentInsurance: 30, totalIncomeTax: 30, totalOtherDeductions: 0, totalNet: 900,
  };
  const lines = [
    { accountCode: '5010', debit: 1000 },
    { accountCode: '5040', debit: 230 },
    { accountCode: '2030', credit: 300 },
    { accountCode: '2040', credit: 30 },
    { accountCode: '2050', credit: 900 },
  ];

  it('agrees when everything adds up', () => {
    expect(reconcilePayrollRun(run, [payslip], lines, accounts)).toMatchObject({
      ok: true, problems: [], debitTotal: 1230, creditTotal: 1230,
    });
  });

  it('names a payslip that does not add up, a wrong line and an unexpected account', () => {
    const bad = reconcilePayrollRun(
      run,
      [{ ...payslip, netPay: 901 }],
      [...lines.slice(0, 4), { accountCode: '2050', credit: 899 }, { accountCode: '9999', credit: 1 }],
      accounts,
    );
    expect(bad.ok).toBe(false);
    const text = bad.problems.join('\n');
    expect(text).toContain('totalNet vs payslips');
    expect(text).toContain('P1: gross - deductions');
    expect(text).toContain('salaries payable credit');
    expect(text).toContain('unexpected account 9999');
  });
});
