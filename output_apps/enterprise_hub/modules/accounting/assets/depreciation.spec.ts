import { nextMonthCharge, DepreciationTerms } from './depreciation';

describe('nextMonthCharge', () => {
  it('should return 0 when remaining depreciation is 0', () => {
    const terms: DepreciationTerms = {
      costMinor: 100000n,
      salvageMinor: 100000n,
      accumulatedMinor: 0n,
      monthsDone: 0,
      method: 'STRAIGHT_LINE',
      lifeMonths: 12,
      annualRate: null,
    };
    expect(nextMonthCharge(terms)).toBe(0n);
  });

  it('should calculate straight-line depreciation correctly', () => {
    const terms: DepreciationTerms = {
      costMinor: 120000n,
      salvageMinor: 0n,
      accumulatedMinor: 0n,
      monthsDone: 0,
      method: 'STRAIGHT_LINE',
      lifeMonths: 12,
      annualRate: null,
    };
    expect(nextMonthCharge(terms)).toBe(10000n);
  });

  it('should calculate declining-balance depreciation correctly', () => {
    const terms: DepreciationTerms = {
      costMinor: 100000n,
      salvageMinor: 0n,
      accumulatedMinor: 0n,
      monthsDone: 0,
      method: 'DECLINING_BALANCE',
      lifeMonths: null,
      annualRate: '0.25',
    };
    expect(nextMonthCharge(terms)).toBe(2083n);
  });

  it('should not go below salvage value', () => {
    const terms: DepreciationTerms = {
      costMinor: 100000n,
      salvageMinor: 90000n,
      accumulatedMinor: 9999n,
      monthsDone: 11,
      method: 'STRAIGHT_LINE',
      lifeMonths: 12,
      annualRate: null,
    };
    expect(nextMonthCharge(terms)).toBe(1n);
  });

  it('should reject zero life or rate', () => {
    expect(() => {
      const terms: DepreciationTerms = {
        costMinor: 100000n,
        salvageMinor: 0n,
        accumulatedMinor: 0n,
        monthsDone: 0,
        method: 'STRAIGHT_LINE',
        lifeMonths: 0,
        annualRate: null,
      };
      nextMonthCharge(terms);
    }).toThrow('Straight-line depreciation needs a life in months.');

    expect(() => {
      const terms: DepreciationTerms = {
        costMinor: 100000n,
        salvageMinor: 0n,
        accumulatedMinor: 0n,
        monthsDone: 0,
        method: 'DECLINING_BALANCE',
        lifeMonths: null,
        annualRate: null,
      };
      nextMonthCharge(terms);
    }).toThrow('Declining-balance depreciation needs an annual rate.');
  });

  it('should round to whole rials', () => {
    const terms: DepreciationTerms = {
      costMinor: 100000n,
      salvageMinor: 0n,
      accumulatedMinor: 0n,
      monthsDone: 0,
      method: 'DECLINING_BALANCE',
      lifeMonths: null,
      annualRate: '0.25',
    };
    expect(nextMonthCharge(terms)).toBe(2083n);
  });
});
