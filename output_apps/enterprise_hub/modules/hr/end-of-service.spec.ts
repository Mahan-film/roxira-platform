import { calculateEndOfService } from './services/end-of-service';

/** The figures come from the statutory store in production; the tests pass them in. */
const base = { dailyWage: 5_000_000n, daysPerYear: 30, yearDays: 365 };

describe('calculateEndOfService', () => {
  it('pays the configured days of wage per full year', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2020-03-01', terminationDate: '2023-02-28' });
    expect(r.fullYears).toBe(3);
    expect(r.extraDays).toBe(0);
    expect(r.endOfServiceBenefit).toBe(450_000_000n);
    expect(r.leaveSettlement).toBe(0n);
  });

  it('prorates the part year over the configured year basis', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2022-01-01', terminationDate: '2023-06-30' });
    expect(r.fullYears).toBe(1);
    expect(r.extraDays).toBe(181);
    // 150,000,000 + round(150,000,000 * 181 / 365)
    expect(r.endOfServiceBenefit).toBe(150_000_000n + 74_383_562n);
    const alt = calculateEndOfService({ ...base, yearDays: 360, hireDate: '2022-01-01', terminationDate: '2023-06-30' });
    expect(alt.endOfServiceBenefit).toBe(150_000_000n + 75_416_667n);
  });

  it('follows daysPerYear', () => {
    const r = calculateEndOfService({ ...base, daysPerYear: 45, hireDate: '2020-03-01', terminationDate: '2021-02-28' });
    expect(r.endOfServiceBenefit).toBe(225_000_000n);
  });

  it('is zero-year safe: a few days of service earns the pro-rata share', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2024-05-01', terminationDate: '2024-05-10' });
    expect(r.fullYears).toBe(0);
    expect(r.extraDays).toBe(10);
    expect(r.endOfServiceBenefit).toBe(4_109_589n);
  });

  it('adds unused leave at the daily wage, including half days', () => {
    const r = calculateEndOfService({
      ...base,
      hireDate: '2021-01-01',
      terminationDate: '2021-12-31',
      unusedLeaveDays: 2.5,
    });
    expect(r.fullYears).toBe(1);
    expect(r.leaveSettlement).toBe(12_500_000n);
    expect(r.total).toBe(r.endOfServiceBenefit + 12_500_000n);
  });

  it('handles a leap-day hire date', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2020-02-29', terminationDate: '2021-02-27' });
    expect(r.fullYears).toBe(0);
    const r2 = calculateEndOfService({ ...base, hireDate: '2020-02-29', terminationDate: '2021-03-01' });
    expect(r2.fullYears).toBe(1);
  });

  it('stays exact beyond 2^53 rials', () => {
    const r = calculateEndOfService({ ...base, dailyWage: 10n ** 16n, hireDate: '2020-01-01', terminationDate: '2020-12-31' });
    expect(r.endOfServiceBenefit).toBe(30n * 10n ** 16n);
  });

  it('rejects bad input', () => {
    const ok = { hireDate: '2023-01-01', terminationDate: '2023-02-01' };
    expect(() => calculateEndOfService({ ...base, hireDate: '2023-01-02', terminationDate: '2023-01-01' })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, hireDate: 'nope', terminationDate: '2023-01-01' })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, ...ok, dailyWage: -1n })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, ...ok, unusedLeaveDays: -1 })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, ...ok, yearDays: 0 })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, ...ok, daysPerYear: 1.5 })).toThrow(RangeError);
  });
});
