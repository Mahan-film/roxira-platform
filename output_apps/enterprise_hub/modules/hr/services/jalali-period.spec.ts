import {
  compactJalali,
  gregorianToJalali,
  isoDate,
  jalaliMonthDays,
  jalaliMonthEnd,
  jalaliMonthStart,
} from './jalali-period';

describe('jalali-period', () => {
  it('starts Farvardin 1399 on 2020-03-20 and Farvardin 1405 on 2026-03-21', () => {
    expect(isoDate(jalaliMonthStart(1399, 1))).toBe('2020-03-20');
    expect(isoDate(jalaliMonthStart(1405, 1))).toBe('2026-03-21');
  });

  it('has 31 days in months 1-6, 30 in months 7-11', () => {
    for (let m = 1; m <= 6; m++) expect(jalaliMonthDays(1404, m)).toBe(31);
    for (let m = 7; m <= 11; m++) expect(jalaliMonthDays(1404, m)).toBe(30);
  });

  it('has 29 days in Esfand of a normal year and 30 in a leap year', () => {
    expect(jalaliMonthDays(1404, 12)).toBe(29);
    expect(jalaliMonthDays(1403, 12)).toBe(30);
    expect(jalaliMonthDays(1399, 12)).toBe(30);
  });

  it('ends a month one day before the next month starts', () => {
    expect(isoDate(jalaliMonthEnd(1404, 1))).toBe('2025-04-20');
    expect(isoDate(jalaliMonthEnd(1404, 12))).toBe('2026-03-20');
  });

  it('converts Gregorian ISO dates to Jalali parts', () => {
    expect(gregorianToJalali('2020-03-20')).toEqual({ jy: 1399, jm: 1, jd: 1 });
    expect(gregorianToJalali('2026-03-21')).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(gregorianToJalali('2026-03-20T23:00:00Z')).toEqual({ jy: 1404, jm: 12, jd: 29 });
  });

  it('returns null for empty or invalid input', () => {
    expect(gregorianToJalali(null)).toBeNull();
    expect(gregorianToJalali(undefined)).toBeNull();
    expect(gregorianToJalali('not-a-date')).toBeNull();
  });

  it('builds the compact YYYYMMDD form, or an empty string', () => {
    expect(compactJalali('2020-03-20')).toBe('13990101');
    expect(compactJalali('2026-03-21')).toBe('14050101');
    expect(compactJalali('')).toBe('');
    expect(compactJalali('garbage')).toBe('');
  });
});
