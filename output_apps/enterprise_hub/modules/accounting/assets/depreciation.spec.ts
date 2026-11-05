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


/** Runs the monthly charge until nothing is left (or a safety cap), like the monthly job does. */
const runToEnd = (terms: Omit<DepreciationTerms, 'accumulatedMinor' | 'monthsDone'>, cap = 600) => {
  const charges: bigint[] = [];
  let accumulated = 0n;
  for (let month = 0; month < cap; month += 1) {
    if (accumulated >= terms.costMinor - terms.salvageMinor) {
      break;
    }
    const charge = nextMonthCharge({ ...terms, accumulatedMinor: accumulated, monthsDone: month });
    expect(charge).toBeGreaterThanOrEqual(0n);
    charges.push(charge);
    accumulated += charge;
  }
  return { charges, accumulated };
};

describe('nextMonthCharge zero-rounding and write-off', () => {
  it('straight line: a charge that rounds to zero is returned as zero, not negative', () => {
    const terms = { costMinor: 1n, salvageMinor: 0n, method: 'STRAIGHT_LINE' as const, lifeMonths: 12, annualRate: null };
    expect(nextMonthCharge({ ...terms, accumulatedMinor: 0n, monthsDone: 0 })).toBe(0n);
  });

  it('straight line: a tiny asset still sums to cost minus salvage over its life', () => {
    const { charges, accumulated } = runToEnd({
      costMinor: 1n, salvageMinor: 0n, method: 'STRAIGHT_LINE', lifeMonths: 12, annualRate: null,
    });
    expect(accumulated).toBe(1n);
    expect(charges.slice(0, 5)).toEqual([0n, 0n, 0n, 0n, 0n]);
    expect(charges.length).toBeLessThanOrEqual(12);
  });

  it('straight line: the full life adds up exactly to cost minus salvage', () => {
    for (const [cost, salvage, life] of [[10000n, 1n, 7], [99999n, 0n, 36], [100n, 3n, 60]] as const) {
      const { charges, accumulated } = runToEnd({
        costMinor: cost, salvageMinor: salvage, method: 'STRAIGHT_LINE', lifeMonths: life, annualRate: null,
      });
      expect(accumulated).toBe(cost - salvage);
      expect(charges).toHaveLength(life);
    }
  });

  it('declining balance: writes off the remainder once the rate rounds to zero, reaching salvage', () => {
    const { charges, accumulated } = runToEnd({
      costMinor: 20n, salvageMinor: 0n, method: 'DECLINING_BALANCE', lifeMonths: null, annualRate: '1',
    });
    expect(accumulated).toBe(20n);
    expect(charges.every((c) => c > 0n)).toBe(true);
    expect(charges[charges.length - 1]).toBe(5n);
  });

  it('declining balance: never goes below salvage', () => {
    const { accumulated } = runToEnd({
      costMinor: 100000n, salvageMinor: 1234n, method: 'DECLINING_BALANCE', lifeMonths: null, annualRate: '0.25',
    });
    expect(accumulated).toBe(100000n - 1234n);
  });
});
