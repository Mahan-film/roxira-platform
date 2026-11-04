import { AnnualTaxBracket, PayrollYearRates } from './payroll-rates'; // Ensure this import is correct based on your project structure

describe('PayrollYearRates', () => {
  const mockRates: PayrollYearRates = {
    year: 1405,
    source: 'Test Source',
    verified: true,
    unverifiedKeys: [],
    minDailyWage: 100000,
    minMonthlyWage: 3000000,
    housingAllowance: 500000,
    foodAllowance: 300000,
    childAllowancePerChild: 200000,
    seniorityPerYear: 100000,
    monthlyWorkHours: 160,
    payrollMonthDays: 30,
    overtimePremium: 0.5,
    nightShiftPremium: 0.2,
    holidayPremium: 0.3,
    employeeInsuranceRate: 0.07,
    employerInsuranceRate: 0.11,
    unemploymentInsuranceRate: 0.005,
    maxInsurableMonthlyWage: 15000000,
    annualTaxBrackets: [
      { upTo: 100000000, rate: '0.0' },
      { upTo: 200000000, rate: '0.1' },
      { upTo: null, rate: '0.15' }
    ],
    marriageAllowance: 400000,
    flatTaxRate: '0.1',
    eidiExemptCeiling: 5000000,
    nonCashExemptAnnual: 10000000,
    insuranceRates: {
      employee: '0.07',
      employer: '0.11',
      unemployment: '0.005'
    }
  };

  it('should have all required properties', () => {
    expect(mockRates).toHaveProperty('year');
    expect(mockRates).toHaveProperty('source');
    expect(mockRates).toHaveProperty('verified');
    expect(mockRates).toHaveProperty('unverifiedKeys');
    expect(mockRates).toHaveProperty('minDailyWage');
    expect(mockRates).toHaveProperty('minMonthlyWage');
    expect(mockRates).toHaveProperty('housingAllowance');
    expect(mockRates).toHaveProperty('foodAllowance');
    expect(mockRates).toHaveProperty('childAllowancePerChild');
    expect(mockRates).toHaveProperty('seniorityPerYear');
    expect(mockRates).toHaveProperty('monthlyWorkHours');
    expect(mockRates).toHaveProperty('payrollMonthDays');
    expect(mockRates).toHaveProperty('overtimePremium');
    expect(mockRates).toHaveProperty('nightShiftPremium');
    expect(mockRates).toHaveProperty('holidayPremium');
    expect(mockRates).toHaveProperty('employeeInsuranceRate');
    expect(mockRates).toHaveProperty('employerInsuranceRate');
    expect(mockRates).toHaveProperty('unemploymentInsuranceRate');
    expect(mockRates).toHaveProperty('maxInsurableMonthlyWage');
    expect(mockRates).toHaveProperty('annualTaxBrackets');
    expect(mockRates).toHaveProperty('marriageAllowance');
    expect(mockRates).toHaveProperty('flatTaxRate');
    expect(mockRates).toHaveProperty('eidiExemptCeiling');
    expect(mockRates).toHaveProperty('nonCashExemptAnnual');
    expect(mockRates).toHaveProperty('insuranceRates');
  });

  it('should have valid rates between 0 and 1', () => {
    expect(mockRates.overtimePremium).toBeGreaterThanOrEqual(0);
    expect(mockRates.overtimePremium).toBeLessThanOrEqual(1);
    expect(mockRates.nightShiftPremium).toBeGreaterThanOrEqual(0);
    expect(mockRates.nightShiftPremium).toBeLessThanOrEqual(1);
    expect(mockRates.holidayPremium).toBeGreaterThanOrEqual(0);
    expect(mockRates.holidayPremium).toBeLessThanOrEqual(1);
    expect(mockRates.employeeInsuranceRate).toBeGreaterThanOrEqual(0);
    expect(mockRates.employeeInsuranceRate).toBeLessThanOrEqual(1);
    expect(mockRates.employerInsuranceRate).toBeGreaterThanOrEqual(0);
    expect(mockRates.employerInsuranceRate).toBeLessThanOrEqual(1);
    expect(mockRates.unemploymentInsuranceRate).toBeGreaterThanOrEqual(0);
    expect(mockRates.unemploymentInsuranceRate).toBeLessThanOrEqual(1);
  });

  it('should have positive caps', () => {
    expect(mockRates.minDailyWage).toBeGreaterThan(0);
    expect(mockRates.minMonthlyWage).toBeGreaterThan(0);
    expect(mockRates.housingAllowance).toBeGreaterThan(0);
    expect(mockRates.foodAllowance).toBeGreaterThan(0);
    expect(mockRates.childAllowancePerChild).toBeGreaterThan(0);
    expect(mockRates.seniorityPerYear).toBeGreaterThan(0);
    expect(mockRates.monthlyWorkHours).toBeGreaterThan(0);
    expect(mockRates.payrollMonthDays).toBeGreaterThan(0);
    expect(mockRates.maxInsurableMonthlyWage).toBeGreaterThan(0);
    expect(mockRates.marriageAllowance).toBeGreaterThan(0);
    expect(mockRates.eidiExemptCeiling).toBeGreaterThan(0);
    expect(mockRates.nonCashExemptAnnual).toBeGreaterThan(0);
  });

  it('should have valid annual tax brackets', () => {
    expect(mockRates.annualTaxBrackets).toBeInstanceOf(Array);
    expect(mockRates.annualTaxBrackets.length).toBeGreaterThan(0);
    mockRates.annualTaxBrackets.forEach((bracket: AnnualTaxBracket) => {
      expect(bracket).toHaveProperty('upTo');
      expect(bracket).toHaveProperty('rate');
      if (bracket.upTo !== null) {
        expect(bracket.upTo).toBeGreaterThan(0);
      }
      expect(parseFloat(bracket.rate)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(bracket.rate)).toBeLessThanOrEqual(1);
    });
  });

  it('should have valid insurance rates', () => {
    expect(mockRates.insuranceRates).toHaveProperty('employee');
    expect(mockRates.insuranceRates).toHaveProperty('employer');
    expect(mockRates.insuranceRates).toHaveProperty('unemployment');
    expect(parseFloat(mockRates.insuranceRates.employee)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(mockRates.insuranceRates.employee)).toBeLessThanOrEqual(1);
    expect(parseFloat(mockRates.insuranceRates.employer)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(mockRates.insuranceRates.employer)).toBeLessThanOrEqual(1);
    expect(parseFloat(mockRates.insuranceRates.unemployment)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(mockRates.insuranceRates.unemployment)).toBeLessThanOrEqual(1);
  });

  it('should have valid flat tax rate', () => {
    if (mockRates.flatTaxRate !== null) {
      expect(parseFloat(mockRates.flatTaxRate)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(mockRates.flatTaxRate)).toBeLessThanOrEqual(1);
    }
  });

  it('should return expected values for year 1405', () => {
    expect(mockRates.year).toBe(1405);
    expect(mockRates.source).toBe('Test Source');
    expect(mockRates.verified).toBe(true);
    expect(mockRates.unverifiedKeys).toEqual([]);
    expect(mockRates.minDailyWage).toBe(100000);
    expect(mockRates.minMonthlyWage).toBe(3000000);
    expect(mockRates.housingAllowance).toBe(500000);
    expect(mockRates.foodAllowance).toBe(300000);
    expect(mockRates.childAllowancePerChild).toBe(200000);
    expect(mockRates.seniorityPerYear).toBe(100000);
    expect(mockRates.monthlyWorkHours).toBe(160);
    expect(mockRates.payrollMonthDays).toBe(30);
    expect(mockRates.overtimePremium).toBe(0.5);
    expect(mockRates.nightShiftPremium).toBe(0.2);
    expect(mockRates.holidayPremium).toBe(0.3);
    expect(mockRates.employeeInsuranceRate).toBe(0.07);
    expect(mockRates.employerInsuranceRate).toBe(0.11);
    expect(mockRates.unemploymentInsuranceRate).toBe(0.005);
    expect(mockRates.maxInsurableMonthlyWage).toBe(15000000);
    expect(mockRates.annualTaxBrackets).toEqual([
      { upTo: 100000000, rate: '0.0' },
      { upTo: 200000000, rate: '0.1' },
      { upTo: null, rate: '0.15' }
    ]);
    expect(mockRates.marriageAllowance).toBe(400000);
    expect(mockRates.flatTaxRate).toBe('0.1');
    expect(mockRates.eidiExemptCeiling).toBe(5000000);
    expect(mockRates.nonCashExemptAnnual).toBe(10000000);
    expect(mockRates.insuranceRates).toEqual({
      employee: '0.07',
      employer: '0.11',
      unemployment: '0.005'
    });
  });
});
