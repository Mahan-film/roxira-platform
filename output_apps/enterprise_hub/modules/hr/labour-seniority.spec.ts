import { readFileSync } from 'fs';
import { join } from 'path';
import { seededRates } from './statutory/__fixtures__/seeded-rates';
import { isoDate, jalaliMonthStart } from './services/jalali-period';
import { calculatePayroll, seniorityDayUnits } from './services/payroll-calculator';

const DAILY = 166_667;
const rates = seededRates(1405);

/** ISO date of Jalali year/month/day. */
const iso = (y: number, m: number, d: number): string =>
  isoDate(new Date(jalaliMonthStart(y, m).getTime() + (d - 1) * 86_400_000));

describe('LAB-01: seniority base (paye sanavat) by year of service', () => {
  it('pays nothing before the first Jalali anniversary and one base after it', () => {
    // hired 1404/03/15; month 1405/03 has 31 days: days 1-14 are year 0, days 15-31 are year 1.
    expect(seniorityDayUnits(iso(1404, 3, 15), 1405, 3)).toBe(17);
    expect(seniorityDayUnits(iso(1404, 3, 15), 1405, 2)).toBe(0);
  });

  it('adds one base per completed year, from the anniversary day', () => {
    // hired 1403/05/10; 1405/05 has 31 days: days 1-9 one year, days 10-31 two years.
    expect(seniorityDayUnits(iso(1403, 5, 10), 1405, 5)).toBe(9 * 1 + 22 * 2);
  });

  it('a full month at N years equals N bases for every day', () => {
    expect(seniorityDayUnits(iso(1402, 1, 1), 1405, 7)).toBe(3 * 30);
  });

  it('is zero for no, invalid or future hire dates', () => {
    expect(seniorityDayUnits(null, 1405, 5)).toBe(0);
    expect(seniorityDayUnits('garbage', 1405, 5)).toBe(0);
    expect(seniorityDayUnits(iso(1405, 6, 1), 1405, 5)).toBe(0);
  });

  it('prices the day units with the daily figure from the store', () => {
    const base = {
      rates,
      monthlyBaseWage: 166_255_500,
      housingAllowance: 0,
      foodAllowance: 0,
      children: 0,
      seniorityYears: 2,
    };
    const mid = calculatePayroll({ ...base, monthDays: 31, seniorityDayUnits: 53 });
    expect(mid.seniorityAmount).toBe(53 * DAILY);
    // Full 30-day month at two years is unchanged from the whole-month path.
    const full = calculatePayroll({ ...base, monthDays: 30, seniorityDayUnits: 60 });
    expect(full.seniorityAmount).toBe(calculatePayroll({ ...base, monthDays: 30 }).seniorityAmount);
    expect(full.seniorityAmount).toBe(10_000_020);
  });
});

describe('LAB-01: 1405 figures against the council circular 6682', () => {
  const text = readFileSync(
    join(__dirname, '../../../../docs/legal_sources/iran/wage-circular-1405.txt'),
    'utf8',
  )
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[,.،]/g, '');

  it.each([
    ['min_daily_wage art.1', '5541850', rates.minDailyWage],
    ['seniority base art.2', '166667', rates.seniorityPerYear / 30],
    ['consumables allowance art.3', '22000000', rates.foodAllowance],
    ['marriage allowance art.4', '5000000', rates.marriageAllowance],
  ])('%s is in the circular and equals the store value', (_name, digits, stored) => {
    expect(text).toContain(digits);
    expect(stored).toBe(Number(digits));
  });

  it('monthly minimum is 30 days of the daily minimum', () => {
    expect(rates.minMonthlyWage).toBe(5_541_850 * 30);
  });
});
