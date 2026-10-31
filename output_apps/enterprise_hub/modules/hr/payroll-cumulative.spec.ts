import { AllowanceTaxTreatment, WageTaxRegime } from './enums/hr.enum';
import { applyRate, calculatePayroll, cumulativeBandTax, cumulativeTax, PayrollYearToDate } from './services/payroll-calculator';
import { buildInsuranceList, InsuranceListWorker } from './services/insurance-list';
import { seededRates } from './statutory/__fixtures__/seeded-rates';

const rates = seededRates(1405);
const bands = rates.annualTaxBrackets;
const M = 1_000_000;
const noYtd: PayrollYearToDate = { months: 0, taxableIncome: 0, progressiveTax: 0, nonCash: 0, eidi: 0 };

/** Numeric cases of docs/research/2026-10-31/05-iran-compliance-1405-fa.md. */
describe('report cases', () => {
  it('BDG-01: 380M a month is below the exemption', () => {
    expect(cumulativeBandTax(380 * M, 1, bands)).toBe(0);
  });

  it('BDG-02: 900M a month pays 55M', () => {
    expect(cumulativeBandTax(900 * M, 1, bands)).toBe(55 * M);
  });

  it('BDG-03: faculty on 600M pays a flat 10% above the exemption', () => {
    const result = calculatePayroll({
      rates,
      monthlyBaseWage: 600 * M,
      housingAllowance: 0,
      foodAllowance: 0,
      children: 0,
      seniorityYears: 0,
      insuranceSubject: false,
      taxRegime: WageTaxRegime.FLAT,
    });
    expect(result.incomeTax).toBe(20 * M);
  });

  const base = {
    rates,
    housingAllowance: 0,
    foodAllowance: 0,
    children: 0,
    seniorityYears: 0,
    insuranceSubject: false,
  };

  it('BDG-04: 550M eidi with the exemption used pays 15M', () => {
    const result = calculatePayroll({
      ...base,
      monthlyBaseWage: 400 * M,
      eidi: 550 * M,
      yearToDate: { ...noYtd, months: 11, taxableIncome: 4_400 * M },
    });
    expect(result.taxableIncome).toBe(550 * M);
    expect(result.incomeTax).toBe(15 * M);
  });

  it('BDG-05: 920M non-cash in a year leaves 120M taxable', () => {
    const result = calculatePayroll({
      ...base,
      monthlyBaseWage: 0,
      allowances: [
        { title: 'بن', amount: 120 * M, insurable: false, taxTreatment: AllowanceTaxTreatment.NON_CASH },
      ],
      yearToDate: { ...noYtd, nonCash: 800 * M },
    });
    expect(result.taxableIncome).toBe(120 * M);
  });

  it('INS-01: two workers, 31 days, 5M a day, 30M benefits', () => {
    const worker: InsuranceListWorker = {
      insuranceNumber: '12345678',
      firstName: 'الف',
      lastName: 'ب',
      fatherName: null,
      nationalId: '0012345679',
      birthDate: '',
      gender: 'MALE',
      jobTitle: 'کارگر',
      startDate: '',
      endDate: '',
      workDays: 31,
      dailyWage: 5 * M,
      insurableWage: 185 * M,
      grossPay: 185 * M,
      employeeInsurance: 0,
      employerInsurance: 0,
      unemploymentInsurance: 0,
    };
    const files = buildInsuranceList(
      { workshopCode: '1234567890', workshopName: 'ک', employerName: 'ف' },
      1405,
      1,
      [worker, worker],
      23,
    );
    const [head, row] = files.workshopFile.trim().split('\r\n');
    const k = Object.fromEntries(head.split(',').map((f, i) => [f, row.split(',')[i]]));
    expect(k.DSK_TDD).toBe('62');
    expect(k.DSK_TROOZ).toBe('10000000');
    expect(k.DSK_TMAH).toBe('310000000');
    expect(k.DSK_TMAZ).toBe('60000000');
  });
});

describe('cumulative tax', () => {
  it('a steady salary pays the same tax each month and the annual tax in total', () => {
    let income = 0;
    let withheld = 0;
    for (let month = 1; month <= 12; month += 1) {
      income += 900 * M;
      const tax = cumulativeTax(income, month, bands, withheld);
      expect(tax).toBe(55 * M);
      withheld += tax;
    }
    expect(withheld).toBe(660 * M);
  });

  it('a low month recovers exemption from a high month, never below zero', () => {
    expect(cumulativeTax(1_000 * M, 2, bands, 90 * M)).toBe(0);
    const high = cumulativeBandTax(900 * M, 1, bands);
    expect(cumulativeTax(1_000 * M, 2, bands, high)).toBe(0);
    expect(cumulativeBandTax(1_000 * M, 2, bands)).toBe(20 * M);
  });

  it('counts months on payroll, so a mid-year hire gets one month of exemption', () => {
    const result = calculatePayroll({
      rates,
      monthlyBaseWage: 500 * M,
      housingAllowance: 0,
      foodAllowance: 0,
      children: 0,
      seniorityYears: 0,
      insuranceSubject: false,
    });
    expect(result.incomeTax).toBe(10 * M);
  });
});

describe('exact rial arithmetic', () => {
  it('rounds half up without floating error', () => {
    expect(applyRate(50, '0.07')).toBe(4);
    expect(applyRate(1_163_788_500, '0.07')).toBe(81_465_195);
    expect(applyRate(15, '0.1')).toBe(2);
  });
});

describe('month, marriage and allowances', () => {
  const worker = {
    rates,
    monthlyBaseWage: 166_255_500,
    housingAllowance: 30 * M,
    foodAllowance: 22 * M,
    children: 0,
    seniorityYears: 0,
  };

  it('pays base wage for calendar days; monthly allowances stay monthly', () => {
    const result = calculatePayroll({ ...worker, monthDays: 31 });
    expect(result.baseWage).toBe(5_541_850 * 31);
    expect(result.housingAllowance).toBe(30 * M);
    expect(result.workDays).toBe(31);
    expect(result.dailyWage).toBe(5_541_850);
  });

  it('adds the marriage allowance from circular 6682 for married staff', () => {
    expect(calculatePayroll({ ...worker, married: true }).marriageAllowance).toBe(5 * M);
    expect(calculatePayroll(worker).marriageAllowance).toBe(0);
  });

  it('keeps non-insurable and exempt allowances out of each base', () => {
    const plain = calculatePayroll(worker);
    const result = calculatePayroll({
      ...worker,
      allowances: [
        { title: 'الف', amount: 10 * M, insurable: false, taxTreatment: AllowanceTaxTreatment.EXEMPT },
      ],
    });
    expect(result.grossPay).toBe(plain.grossPay + 10 * M);
    expect(result.insurableWage).toBe(plain.insurableWage);
    expect(result.taxableIncome).toBe(plain.taxableIncome);
  });

  it('taxes a flat allowance apart from the progressive base', () => {
    const result = calculatePayroll({
      ...worker,
      allowances: [
        { title: 'ب', amount: 10 * M, insurable: false, taxTreatment: AllowanceTaxTreatment.FLAT },
      ],
    });
    expect(result.flatTax).toBe(1 * M);
    expect(result.incomeTax).toBe(1 * M);
  });
});
