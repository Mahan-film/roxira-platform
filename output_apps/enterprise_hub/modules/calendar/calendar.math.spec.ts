import {
  GREGORIAN_MAX_YEAR,
  GREGORIAN_MIN_YEAR,
  JALALI_MAX_YEAR,
  JALALI_MIN_YEAR,
  addDays,
  addMonths,
  addYears,
  compare,
  convert,
  daysInMonth,
  daysInYear,
  diffDays,
  endOfMonth,
  formatDate,
  fromEpochDay,
  isGregorianLeap,
  isJalaliLeap,
  isLeapYear,
  isValid,
  isoWeekday,
  jalaliWeekday,
  parseDate,
  toEpochDay,
} from './calendar.math';
import { CalendarDate } from './calendar.types';

const j = (year: number, month: number, day: number): CalendarDate => ({
  calendar: 'jalali',
  year,
  month,
  day,
});
const g = (year: number, month: number, day: number): CalendarDate => ({
  calendar: 'gregorian',
  year,
  month,
  day,
});

const icu = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function icuJalali(epochDay: number): { year: number; month: number; day: number } {
  const parts = icu.formatToParts(new Date(epochDay * 86_400_000));
  const pick = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

describe('leap years', () => {
  it('Gregorian: divisible by 4, not by 100 unless by 400', () => {
    for (const y of [1600, 1904, 1996, 2000, 2004, 2024, 2028, 2400]) expect(isGregorianLeap(y)).toBe(true);
    for (const y of [1700, 1800, 1900, 2001, 2023, 2100, 2200, 2025]) expect(isGregorianLeap(y)).toBe(false);
  });

  it('Jalali: published leap years of the recent past and near future', () => {
    for (const y of [1370, 1375, 1379, 1383, 1387, 1391, 1395, 1399, 1403, 1408, 1412]) {
      expect(isJalaliLeap(y)).toBe(true);
    }
    for (const y of [1398, 1400, 1401, 1402, 1404, 1405, 1406, 1407, 1409]) {
      expect(isJalaliLeap(y)).toBe(false);
    }
  });

  it('Jalali: exactly 8 leap years in every 33-year cycle', () => {
    for (let start = JALALI_MIN_YEAR; start <= JALALI_MAX_YEAR - 33; start += 7) {
      let count = 0;
      for (let y = start; y < start + 33; y++) if (isJalaliLeap(y)) count++;
      expect(count).toBe(8);
    }
  });

  it('Jalali leap years match the platform ICU Persian calendar for every supported year', () => {
    for (let y = JALALI_MIN_YEAR; y < JALALI_MAX_YEAR; y++) {
      // The day before 1 Farvardin of y+1 is 29 or 30 Esfand of y.
      const lastDay = icuJalali(toEpochDay(j(y + 1, 1, 1)) - 1);
      expect(lastDay.month).toBe(12);
      expect(lastDay.day === 30).toBe(isJalaliLeap(y));
    }
  });

  it('isLeapYear and daysInYear dispatch by calendar', () => {
    expect(isLeapYear('jalali', 1403)).toBe(true);
    expect(isLeapYear('gregorian', 1403)).toBe(false);
    expect(daysInYear('jalali', 1403)).toBe(366);
    expect(daysInYear('jalali', 1404)).toBe(365);
    expect(daysInYear('gregorian', 2024)).toBe(366);
    expect(daysInYear('gregorian', 2100)).toBe(365);
  });
});

describe('month lengths', () => {
  it('Jalali months: 31 x6, 30 x5, Esfand 29 or 30', () => {
    const common = Array.from({ length: 12 }, (_, i) => daysInMonth('jalali', 1404, i + 1));
    expect(common).toEqual([31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29]);
    expect(daysInMonth('jalali', 1403, 12)).toBe(30);
    expect(common.reduce((a, b) => a + b, 0)).toBe(365);
  });

  it('Gregorian months incl. February in leap, century and 400-year cases', () => {
    expect(daysInMonth('gregorian', 2024, 2)).toBe(29);
    expect(daysInMonth('gregorian', 2023, 2)).toBe(28);
    expect(daysInMonth('gregorian', 2100, 2)).toBe(28);
    expect(daysInMonth('gregorian', 2000, 2)).toBe(29);
    expect(daysInMonth('gregorian', 2025, 4)).toBe(30);
    expect(daysInMonth('gregorian', 2025, 12)).toBe(31);
  });

  it('rejects months outside 1..12 and non-integers', () => {
    expect(() => daysInMonth('jalali', 1404, 0)).toThrow();
    expect(() => daysInMonth('jalali', 1404, 13)).toThrow();
    expect(() => daysInMonth('gregorian', 2025, 1.5)).toThrow();
    expect(() => isJalaliLeap(1403.5)).toThrow();
  });
});

describe('validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValid(j(1403, 12, 30))).toBe(true);
    expect(isValid(j(1404, 12, 30))).toBe(false);
    expect(isValid(j(1404, 7, 31))).toBe(false);
    expect(isValid(j(1404, 6, 31))).toBe(true);
    expect(isValid(g(2024, 2, 29))).toBe(true);
    expect(isValid(g(2023, 2, 29))).toBe(false);
    expect(isValid(g(2025, 4, 31))).toBe(false);
    expect(isValid(g(2025, 0, 1))).toBe(false);
    expect(isValid(g(2025, 1, 0))).toBe(false);
  });

  it('refuses years outside the verified range instead of guessing', () => {
    expect(isValid(j(JALALI_MIN_YEAR - 1, 1, 1))).toBe(false);
    expect(isValid(j(JALALI_MAX_YEAR + 1, 1, 1))).toBe(false);
    expect(isValid(g(GREGORIAN_MIN_YEAR - 1, 1, 1))).toBe(false);
    expect(isValid(g(GREGORIAN_MAX_YEAR + 1, 1, 1))).toBe(false);
    expect(isValid(j(JALALI_MIN_YEAR, 1, 1))).toBe(true);
    expect(isValid(g(GREGORIAN_MAX_YEAR, 12, 31))).toBe(true);
  });
});

describe('conversion', () => {
  it('known anchor dates', () => {
    expect(convert(j(1403, 1, 1), 'gregorian')).toEqual(g(2024, 3, 20));
    expect(convert(j(1404, 1, 1), 'gregorian')).toEqual(g(2025, 3, 21));
    expect(convert(j(1403, 12, 30), 'gregorian')).toEqual(g(2025, 3, 20));
    expect(convert(j(1399, 12, 30), 'gregorian')).toEqual(g(2021, 3, 20));
    expect(convert(j(1357, 11, 22), 'gregorian')).toEqual(g(1979, 2, 11));
    expect(convert(g(1970, 1, 1), 'jalali')).toEqual(j(1348, 10, 11));
    expect(convert(g(2000, 1, 1), 'jalali')).toEqual(j(1378, 10, 11));
    expect(convert(g(2024, 2, 29), 'jalali')).toEqual(j(1402, 12, 10));
  });

  it('same calendar returns an equal copy', () => {
    const d = j(1404, 5, 5);
    const c = convert(d, 'jalali');
    expect(c).toEqual(d);
    expect(c).not.toBe(d);
  });

  it('epoch day 0 is 1970-01-01 and day numbers are consecutive', () => {
    expect(toEpochDay(g(1970, 1, 1))).toBe(0);
    expect(toEpochDay(g(1969, 12, 31))).toBe(-1);
    expect(toEpochDay(g(2024, 3, 1)) - toEpochDay(g(2024, 2, 29))).toBe(1);
    expect(toEpochDay(j(1404, 1, 1)) - toEpochDay(j(1403, 12, 30))).toBe(1);
    expect(toEpochDay(j(1405, 1, 1)) - toEpochDay(j(1404, 12, 29))).toBe(1);
  });

  it('every day of every supported Jalali year matches ICU and round-trips', () => {
    const first = toEpochDay(j(JALALI_MIN_YEAR, 1, 1));
    const last = toEpochDay(j(JALALI_MAX_YEAR, 12, 29));
    for (let e = first; e <= last; e++) {
      const expected = icuJalali(e);
      const ours = fromEpochDay('jalali', e);
      if (
        ours.year !== expected.year ||
        ours.month !== expected.month ||
        ours.day !== expected.day
      ) {
        throw new Error(
          `mismatch at epoch day ${e}: ours ${formatDate(ours)} vs ICU ${expected.year}-${expected.month}-${expected.day}`,
        );
      }
      if (toEpochDay(ours) !== e) throw new Error(`round trip failed at ${e}`);
    }
  });

  it('every day of every supported Gregorian year matches Date and round-trips', () => {
    const first = toEpochDay(g(GREGORIAN_MIN_YEAR, 1, 1));
    const last = toEpochDay(g(GREGORIAN_MAX_YEAR, 12, 31));
    for (let e = first; e <= last; e++) {
      const native = new Date(e * 86_400_000);
      const ours = fromEpochDay('gregorian', e);
      if (
        ours.year !== native.getUTCFullYear() ||
        ours.month !== native.getUTCMonth() + 1 ||
        ours.day !== native.getUTCDate()
      ) {
        throw new Error(`mismatch at epoch day ${e}`);
      }
      if (toEpochDay(ours) !== e) throw new Error(`round trip failed at ${e}`);
    }
  });

  it('jalali -> gregorian -> jalali is the identity on every month boundary', () => {
    for (let y = JALALI_MIN_YEAR + 1; y < JALALI_MAX_YEAR; y++) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, daysInMonth('jalali', y, m)]) {
          const original = j(y, m, d);
          expect(convert(convert(original, 'gregorian'), 'jalali')).toEqual(original);
        }
      }
    }
  });

  it('the whole Jalali range converts to Gregorian and back, boundary years included', () => {
    expect(convert(j(JALALI_MIN_YEAR, 1, 1), 'gregorian')).toEqual(g(1827, 3, 22));
    expect(convert(j(JALALI_MAX_YEAR, 12, 29), 'gregorian')).toEqual(g(2122, 3, 20));
    for (const d of [j(JALALI_MIN_YEAR, 1, 1), j(JALALI_MIN_YEAR, 12, 29), j(JALALI_MAX_YEAR, 1, 1), j(JALALI_MAX_YEAR, 12, 29)]) {
      expect(convert(convert(d, 'gregorian'), 'jalali')).toEqual(d);
    }
  });

  it('convert validates even when the calendar does not change', () => {
    expect(() => convert(j(1404, 12, 30), 'jalali')).toThrow();
  });

  it('refuses epoch days outside the supported range', () => {
    expect(() => fromEpochDay('jalali', toEpochDay(j(JALALI_MAX_YEAR, 12, 29)) + 400)).toThrow();
    expect(() => fromEpochDay('gregorian', -200_000)).toThrow();
    expect(() => fromEpochDay('gregorian', 1.5)).toThrow();
  });
});

describe('period maths', () => {
  it('addDays crosses month, year and leap-day boundaries in both calendars', () => {
    expect(addDays(j(1403, 12, 29), 1)).toEqual(j(1403, 12, 30));
    expect(addDays(j(1403, 12, 30), 1)).toEqual(j(1404, 1, 1));
    expect(addDays(j(1404, 12, 29), 1)).toEqual(j(1405, 1, 1));
    expect(addDays(j(1404, 6, 31), 1)).toEqual(j(1404, 7, 1));
    expect(addDays(g(2024, 2, 28), 1)).toEqual(g(2024, 2, 29));
    expect(addDays(g(2023, 2, 28), 1)).toEqual(g(2023, 3, 1));
    expect(addDays(g(2025, 1, 1), -1)).toEqual(g(2024, 12, 31));
    expect(addDays(j(1404, 1, 1), 0)).toEqual(j(1404, 1, 1));
    expect(addDays(j(1404, 1, 1), 365)).toEqual(j(1405, 1, 1));
    expect(addDays(j(1403, 1, 1), 366)).toEqual(j(1404, 1, 1));
  });

  it('addMonths clamps to the last day of the target month', () => {
    expect(addMonths(j(1404, 6, 31), 1)).toEqual(j(1404, 7, 30));
    expect(addMonths(j(1404, 1, 31), 11)).toEqual(j(1404, 12, 29));
    expect(addMonths(j(1403, 1, 31), 11)).toEqual(j(1403, 12, 30));
    expect(addMonths(j(1404, 12, 29), 12)).toEqual(j(1405, 12, 29));
    expect(addMonths(j(1403, 12, 30), 12)).toEqual(j(1404, 12, 29));
    expect(addMonths(g(2025, 1, 31), 1)).toEqual(g(2025, 2, 28));
    expect(addMonths(g(2024, 1, 31), 1)).toEqual(g(2024, 2, 29));
    expect(addMonths(g(2024, 2, 29), 12)).toEqual(g(2025, 2, 28));
    expect(addMonths(g(2024, 2, 29), 48)).toEqual(g(2028, 2, 29));
  });

  it('addMonths goes backwards and across many years', () => {
    expect(addMonths(j(1404, 1, 15), -1)).toEqual(j(1403, 12, 15));
    expect(addMonths(j(1404, 1, 15), -13)).toEqual(j(1402, 12, 15));
    expect(addMonths(g(2025, 1, 15), -1)).toEqual(g(2024, 12, 15));
    expect(addMonths(g(2025, 3, 31), -1)).toEqual(g(2025, 2, 28));
    expect(addMonths(g(2025, 5, 5), 0)).toEqual(g(2025, 5, 5));
    expect(addMonths(j(1404, 5, 5), 120)).toEqual(j(1414, 5, 5));
  });

  it('addYears is twelve months', () => {
    expect(addYears(g(2024, 2, 29), 1)).toEqual(g(2025, 2, 28));
    expect(addYears(j(1403, 12, 30), -1)).toEqual(j(1402, 12, 29));
  });

  it('diffDays works across calendars and signs', () => {
    expect(diffDays(j(1403, 1, 1), j(1404, 1, 1))).toBe(366);
    expect(diffDays(j(1404, 1, 1), j(1405, 1, 1))).toBe(365);
    expect(diffDays(g(2024, 3, 20), j(1403, 1, 1))).toBe(0);
    expect(diffDays(g(2024, 1, 1), g(2025, 1, 1))).toBe(366);
    expect(diffDays(j(1404, 1, 1), j(1403, 1, 1))).toBe(-366);
  });

  it('compare orders dates across calendars', () => {
    expect(compare(j(1403, 1, 1), g(2024, 3, 21))).toBe(-1);
    expect(compare(j(1403, 1, 1), g(2024, 3, 20))).toBe(0);
    expect(compare(j(1403, 1, 2), g(2024, 3, 20))).toBe(1);
  });

  it('endOfMonth', () => {
    expect(endOfMonth('jalali', 1403, 12)).toEqual(j(1403, 12, 30));
    expect(endOfMonth('jalali', 1404, 12)).toEqual(j(1404, 12, 29));
    expect(endOfMonth('gregorian', 2024, 2)).toEqual(g(2024, 2, 29));
  });

  it('weekdays: 2024-03-20 was a Wednesday, so 1 Farvardin 1403 is Wednesday', () => {
    expect(isoWeekday(g(2024, 3, 20))).toBe(3);
    expect(isoWeekday(j(1403, 1, 1))).toBe(3);
    expect(isoWeekday(g(1970, 1, 1))).toBe(4);
    expect(isoWeekday(g(2024, 3, 24))).toBe(7);
    expect(jalaliWeekday(g(2024, 3, 23))).toBe(0); // Saturday
    expect(jalaliWeekday(g(2024, 3, 22))).toBe(6); // Friday
  });
});

describe('format and parse', () => {
  it('round-trips with zero padding and accepts / as separator', () => {
    expect(formatDate(j(1404, 1, 5))).toBe('1404-01-05');
    expect(parseDate('jalali', '1404-01-05')).toEqual(j(1404, 1, 5));
    expect(parseDate('jalali', '1404/01/05')).toEqual(j(1404, 1, 5));
    expect(parseDate('gregorian', '2024-02-29')).toEqual(g(2024, 2, 29));
  });

  it('rejects malformed text, non-ASCII digits and impossible dates', () => {
    expect(() => parseDate('jalali', '1404-1-5')).toThrow();
    expect(() => parseDate('jalali', '۱۴۰۴-۰۱-۰۵')).toThrow();
    expect(() => parseDate('jalali', '1404-12-30')).toThrow();
    expect(() => parseDate('gregorian', '2023-02-29')).toThrow();
    expect(() => parseDate('gregorian', '')).toThrow();
    expect(() => parseDate('gregorian', '2025-13-01')).toThrow();
  });
});
