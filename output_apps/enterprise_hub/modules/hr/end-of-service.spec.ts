import { calculateEndOfService } from './services/end-of-service';

const base = { dailyWage: 5_000_000 };

describe('calculateEndOfService', () => {
  it('pays 30 days of wage per full year', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2020-03-01', terminationDate: '2023-02-28' });
    expect(r.fullYears).toBe(3);
    expect(r.extraDays).toBe(0);
    expect(r.endOfServiceBenefit).toBe(3 * 30 * 5_000_000);
    expect(r.leaveSettlement).toBe(0);
  });

  it('prorates the part year over 365 days', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2022-01-01', terminationDate: '2023-06-30' });
    expect(r.fullYears).toBe(1);
    expect(r.extraDays).toBe(181);
    // 150,000,000 + round(150,000,000 * 181 / 365)
    expect(r.endOfServiceBenefit).toBe(150_000_000 + Math.round((150_000_000 * 181) / 365));
  });

  it('is zero-year safe: a few days of service earns the pro-rata share', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2024-05-01', terminationDate: '2024-05-10' });
    expect(r.fullYears).toBe(0);
    expect(r.extraDays).toBe(10);
    expect(r.endOfServiceBenefit).toBe(Math.round((150_000_000 * 10) / 365));
  });

  it('adds unused leave at the daily wage, including half days', () => {
    const r = calculateEndOfService({
      ...base,
      hireDate: '2021-01-01',
      terminationDate: '2021-12-31',
      unusedLeaveDays: 2.5,
    });
    expect(r.fullYears).toBe(1);
    expect(r.leaveSettlement).toBe(12_500_000);
    expect(r.total).toBe(r.endOfServiceBenefit + 12_500_000);
  });

  it('handles a leap-day hire date', () => {
    const r = calculateEndOfService({ ...base, hireDate: '2020-02-29', terminationDate: '2021-02-27' });
    expect(r.fullYears).toBe(0);
    const r2 = calculateEndOfService({ ...base, hireDate: '2020-02-29', terminationDate: '2021-03-01' });
    expect(r2.fullYears).toBe(1);
  });

  it('rejects bad input', () => {
    expect(() => calculateEndOfService({ ...base, hireDate: '2023-01-02', terminationDate: '2023-01-01' })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, hireDate: 'nope', terminationDate: '2023-01-01' })).toThrow(RangeError);
    expect(() => calculateEndOfService({ dailyWage: 1.5, hireDate: '2023-01-01', terminationDate: '2023-02-01' })).toThrow(RangeError);
    expect(() => calculateEndOfService({ ...base, hireDate: '2023-01-01', terminationDate: '2023-02-01', unusedLeaveDays: -1 })).toThrow(RangeError);
  });
});
