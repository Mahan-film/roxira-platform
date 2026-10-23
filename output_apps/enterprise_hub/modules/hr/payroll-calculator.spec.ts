import { getPayrollRates, PayrollYearRates } from './constants/payroll-rates';
import {
  buildInsuranceList,
  InsuranceListWorker,
} from './services/insurance-list';
import {
  compactJalali,
  gregorianToJalali,
  isoDate,
  jalaliMonthDays,
  jalaliMonthEnd,
} from './services/jalali-period';
import {
  calculatePayroll,
  progressiveTax,
  serviceYears,
} from './services/payroll-calculator';

const rates1405 = getPayrollRates(1405) as PayrollYearRates;

const minimumWageWorker = {
  rates: rates1405,
  monthlyBaseWage: 166_255_500,
  housingAllowance: 30_000_000,
  foodAllowance: 22_000_000,
  children: 1,
  seniorityYears: 2,
};

describe('payroll rates 1405', () => {
  it('derives monthly minimum wage and the 7x insurable ceiling', () => {
    expect(rates1405.minMonthlyWage).toBe(166_255_500);
    expect(rates1405.maxInsurableMonthlyWage).toBe(1_163_788_500);
    expect(rates1405.childAllowancePerChild).toBe(16_625_550);
    expect(
      rates1405.employerInsuranceRate + rates1405.unemploymentInsuranceRate,
    ).toBeCloseTo(0.23);
  });

  it('returns null for an unconfigured year', () => {
    expect(getPayrollRates(1399)).toBeNull();
  });
});

describe('progressiveTax', () => {
  it('is zero up to the monthly exemption', () => {
    expect(progressiveTax(400_000_000, rates1405.taxBrackets)).toBe(0);
  });

  it('applies each band only to the slice inside it', () => {
    // 400M@0 + 400M@10% + 200M@15% + 200M@20% + 200M@25% + 100M@30%
    expect(progressiveTax(1_500_000_000, rates1405.taxBrackets)).toBe(
      40_000_000 + 30_000_000 + 40_000_000 + 50_000_000 + 30_000_000,
    );
    expect(progressiveTax(500_000_000, rates1405.taxBrackets)).toBe(10_000_000);
  });
});

describe('calculatePayroll', () => {
  it('computes a minimum-wage worker with seniority and one child', () => {
    const result = calculatePayroll(minimumWageWorker);
    expect(result.seniorityAmount).toBe(10_000_000);
    expect(result.childAllowance).toBe(16_625_550);
    expect(result.grossPay).toBe(244_881_050);
    // Child allowance is not subject to insurance premium.
    expect(result.insurableWage).toBe(228_255_500);
    expect(result.employeeInsurance).toBe(15_977_885);
    expect(result.employerInsurance).toBe(45_651_100);
    expect(result.unemploymentInsurance).toBe(6_847_665);
    expect(result.incomeTax).toBe(0);
    expect(result.netPay).toBe(244_881_050 - 15_977_885);
    expect(result.workDays).toBe(30);
  });

  it('pays overtime at +40%, night at 35% and holiday work at +40%', () => {
    const hourly = (166_255_500 + 10_000_000) / 220;
    const result = calculatePayroll({
      ...minimumWageWorker,
      overtimeHours: 10,
      nightHours: 20,
      holidayHours: 8,
    });
    expect(result.overtimeAmount).toBe(Math.round(10 * hourly * 1.4));
    expect(result.nightShiftAmount).toBe(Math.round(20 * hourly * 0.35));
    expect(result.holidayAmount).toBe(Math.round(8 * hourly * 1.4));
    expect(result.grossPay).toBe(
      244_881_050 +
        result.overtimeAmount +
        result.nightShiftAmount +
        result.holidayAmount,
    );
  });

  it('deducts unpaid absence days and reports paid days', () => {
    const result = calculatePayroll({ ...minimumWageWorker, absenceDays: 3 });
    const daily = (166_255_500 + 10_000_000 + 30_000_000 + 22_000_000) / 30;
    expect(result.absenceDeduction).toBe(Math.round(daily * 3));
    expect(result.workDays).toBe(27);
    expect(result.grossPay).toBe(244_881_050 - result.absenceDeduction);
  });

  it('caps the insurable wage and taxes high salaries progressively', () => {
    const result = calculatePayroll({
      rates: rates1405,
      monthlyBaseWage: 2_000_000_000,
      housingAllowance: 0,
      foodAllowance: 0,
      children: 0,
      seniorityYears: 0,
    });
    expect(result.insurableWage).toBe(1_163_788_500);
    expect(result.employeeInsurance).toBe(Math.round(1_163_788_500 * 0.07));
    expect(result.taxableIncome).toBe(2_000_000_000 - result.employeeInsurance);
    expect(result.incomeTax).toBe(
      progressiveTax(result.taxableIncome, rates1405.taxBrackets),
    );
    expect(result.netPay).toBe(
      result.grossPay - result.employeeInsurance - result.incomeTax,
    );
  });

  it('skips insurance for contracts not subject to it and honours other deductions', () => {
    const result = calculatePayroll({
      ...minimumWageWorker,
      insuranceSubject: false,
      otherDeductions: 1_000_000,
    });
    expect(result.insurableWage).toBe(0);
    expect(result.employeeInsurance).toBe(0);
    expect(result.employerInsurance).toBe(0);
    expect(result.netPay).toBe(244_881_050 - 1_000_000);
  });

  it('uses a contract child-allowance override instead of the child count', () => {
    const result = calculatePayroll({
      ...minimumWageWorker,
      children: 3,
      childAllowanceOverride: 5_000_000,
    });
    expect(result.childAllowance).toBe(5_000_000);
  });
});

describe('serviceYears and Jalali period helpers', () => {
  it('counts full years of service only', () => {
    const end = new Date('2026-10-22T00:00:00Z');
    expect(serviceYears('2024-10-22', end)).toBe(2);
    expect(serviceYears('2024-10-23', end)).toBe(1);
    expect(serviceYears(null, end)).toBe(0);
    expect(serviceYears('2027-01-01', end)).toBe(0);
  });

  it('knows Jalali month lengths and ends', () => {
    expect(jalaliMonthDays(1405, 1)).toBe(31);
    expect(jalaliMonthDays(1405, 7)).toBe(30);
    expect(isoDate(jalaliMonthEnd(1405, 7))).toBe('2026-10-22');
    expect(gregorianToJalali('2026-10-22')).toEqual({
      jy: 1405,
      jm: 7,
      jd: 30,
    });
    expect(compactJalali('2026-03-21')).toBe('14050101');
  });
});

describe('buildInsuranceList', () => {
  const worker: InsuranceListWorker = {
    insuranceNumber: '0012345678',
    firstName: 'علی',
    lastName: 'رضایی',
    fatherName: 'حسن',
    nationalId: '0012345679',
    birthDate: '13700101',
    gender: 'MALE',
    jobTitle: 'کارگر, ساده',
    startDate: '',
    endDate: '',
    workDays: 30,
    dailyWage: (166_255_500 + 10_000_000) / 30,
    insurableWage: 228_255_500,
    grossPay: 244_881_050,
    employeeInsurance: 15_977_885,
    employerInsurance: 45_651_100,
    unemploymentInsurance: 6_847_665,
  };

  it('emits DSKKAR00 header totals and DSKWOR00 worker rows', () => {
    const files = buildInsuranceList(
      {
        workshopCode: '1234567890',
        workshopName: 'کارگاه',
        employerName: 'کارفرما',
      },
      1405,
      7,
      [worker, { ...worker, insuranceNumber: null, nationalId: '0098765432' }],
      23,
    );
    const [kHeader, kRow] = files.workshopFile.trim().split('\r\n');
    const kar = Object.fromEntries(
      kHeader.split(',').map((field, i) => [field, kRow.split(',')[i]]),
    );
    expect(kar.DSK_ID).toBe('1234567890');
    expect(kar.DSK_YY).toBe('05');
    expect(kar.DSK_MM).toBe('07');
    expect(kar.DSK_NUM).toBe('2');
    expect(kar.DSK_TDD).toBe('60');
    expect(kar.DSK_TMASH).toBe(String(2 * 228_255_500));
    expect(kar.DSK_TBIME).toBe(String(2 * 15_977_885));
    expect(kar.DSK_TKOSO).toBe(String(2 * 45_651_100));
    expect(kar.DSK_BIC).toBe(String(2 * 6_847_665));
    expect(kar.DSK_RATE).toBe('23');

    const lines = files.workersFile.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('DSW_ID,DSW_YY,DSW_MM,DSW_LISTNO,DSW_ID1')).toBe(
      true,
    );
    // Comma inside a value is quoted.
    expect(lines[1]).toContain('"کارگر, ساده"');
    // MAH = daily × days, MAZ = rest of the insurable wage.
    expect(lines[1]).toContain(',176255500,52000000,228255500,244881050,');
    expect(files.warnings).toHaveLength(1);
    expect(files.warnings[0]).toContain('0098765432');
  });
});
