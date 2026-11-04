import { CalendarService } from './calendar.service';
import { CalendarDate, FiscalYearSpec } from './calendar.types';
import {
  IRAN_FISCAL_YEAR,
  assertFiscalSpec,
  fiscalMonthIndex,
  fiscalMonths,
  fiscalQuarters,
  fiscalYearOf,
  fiscalYearRange,
  rangeContains,
} from './fiscal-year';
import { addDays, daysInYear, formatDate, toEpochDay } from './calendar.math';

const j = (year: number, month: number, day: number): CalendarDate => ({ calendar: 'jalali', year, month, day });
const g = (year: number, month: number, day: number): CalendarDate => ({ calendar: 'gregorian', year, month, day });

/** UK-style: Gregorian year from 6 April, named by the year it starts in. */
const UK: FiscalYearSpec = { calendar: 'gregorian', startMonth: 4, startDay: 6, labelBy: 'start' };
/** Australia-style: from 1 July, named by the year it ends in. */
const AU: FiscalYearSpec = { calendar: 'gregorian', startMonth: 7, startDay: 1, labelBy: 'end' };
const GREGORIAN_CALENDAR_YEAR: FiscalYearSpec = { calendar: 'gregorian', startMonth: 1, startDay: 1, labelBy: 'end' };
/** A company keeping Jalali books but starting in Mehr (1 Mehr), named by the year it ends in. */
const JALALI_MEHR: FiscalYearSpec = { calendar: 'jalali', startMonth: 7, startDay: 1, labelBy: 'end' };

describe('Iran fiscal year (Jalali, 1 Farvardin)', () => {
  it('runs 1 Farvardin to the last day of Esfand, 365 or 366 days', () => {
    const r1404 = fiscalYearRange(IRAN_FISCAL_YEAR, 1404);
    expect(r1404.start).toEqual(j(1404, 1, 1));
    expect(r1404.end).toEqual(j(1404, 12, 29));
    expect(r1404.endExclusive).toEqual(j(1405, 1, 1));
    const r1403 = fiscalYearRange(IRAN_FISCAL_YEAR, 1403);
    expect(r1403.end).toEqual(j(1403, 12, 30));
    expect(toEpochDay(r1403.endExclusive) - toEpochDay(r1403.start)).toBe(daysInYear('jalali', 1403));
  });

  it('1403 maps to 2024-03-20 .. 2025-03-20 in Gregorian', () => {
    const svc = new CalendarService();
    const r = svc.fiscalYearRange(IRAN_FISCAL_YEAR, 1403);
    expect(formatDate(svc.convert(r.start, 'gregorian'))).toBe('2024-03-20');
    expect(formatDate(svc.convert(r.end, 'gregorian'))).toBe('2025-03-20');
  });

  it('assigns dates, including Gregorian ones and the boundary days, to the right year', () => {
    expect(fiscalYearOf(IRAN_FISCAL_YEAR, j(1404, 1, 1))).toBe(1404);
    expect(fiscalYearOf(IRAN_FISCAL_YEAR, j(1403, 12, 30))).toBe(1403);
    expect(fiscalYearOf(IRAN_FISCAL_YEAR, g(2025, 3, 20))).toBe(1403);
    expect(fiscalYearOf(IRAN_FISCAL_YEAR, g(2025, 3, 21))).toBe(1404);
    expect(fiscalYearOf(IRAN_FISCAL_YEAR, g(2025, 12, 31))).toBe(1404);
  });

  it('has 12 months matching Jalali month lengths, back to back, covering the year exactly', () => {
    const months = fiscalMonths(IRAN_FISCAL_YEAR, 1403);
    expect(months).toHaveLength(12);
    expect(months[0].start).toEqual(j(1403, 1, 1));
    expect(months[5].end).toEqual(j(1403, 6, 31));
    expect(months[6].end).toEqual(j(1403, 7, 30));
    expect(months[11].end).toEqual(j(1403, 12, 30));
    for (let i = 1; i < 12; i++) {
      expect(months[i].start).toEqual(months[i - 1].endExclusive);
      expect(months[i].index).toBe(i + 1);
    }
  });

  it('quarters are 93, 93, 90 and 89 or 90 days', () => {
    const lens = (y: number): number[] =>
      fiscalQuarters(IRAN_FISCAL_YEAR, y).map((q) => toEpochDay(q.endExclusive) - toEpochDay(q.start));
    expect(lens(1404)).toEqual([93, 93, 90, 89]);
    expect(lens(1403)).toEqual([93, 93, 90, 90]);
  });

  it('every day of 1399..1410 falls in exactly one month of its year', () => {
    for (let y = 1399; y <= 1410; y++) {
      const range = fiscalYearRange(IRAN_FISCAL_YEAR, y);
      let day = range.start;
      let count = 0;
      while (toEpochDay(day) < toEpochDay(range.endExclusive)) {
        expect(fiscalYearOf(IRAN_FISCAL_YEAR, day)).toBe(y);
        const idx = fiscalMonthIndex(IRAN_FISCAL_YEAR, day);
        expect(idx).toBe(day.month);
        day = addDays(day, 1);
        count++;
      }
      expect(count).toBe(daysInYear('jalali', y));
    }
  });
});

describe('Gregorian fiscal years', () => {
  it('calendar year: 1 Jan to 31 Dec, leap February included', () => {
    const r = fiscalYearRange(GREGORIAN_CALENDAR_YEAR, 2024);
    expect(r.start).toEqual(g(2024, 1, 1));
    expect(r.end).toEqual(g(2024, 12, 31));
    expect(fiscalYearOf(GREGORIAN_CALENDAR_YEAR, g(2024, 2, 29))).toBe(2024);
    expect(fiscalMonths(GREGORIAN_CALENDAR_YEAR, 2024)[1].end).toEqual(g(2024, 2, 29));
    expect(fiscalMonths(GREGORIAN_CALENDAR_YEAR, 2023)[1].end).toEqual(g(2023, 2, 28));
  });

  it('start-named year from 6 April (UK style)', () => {
    const r = fiscalYearRange(UK, 2024);
    expect(r.start).toEqual(g(2024, 4, 6));
    expect(r.end).toEqual(g(2025, 4, 5));
    expect(fiscalYearOf(UK, g(2024, 4, 5))).toBe(2023);
    expect(fiscalYearOf(UK, g(2024, 4, 6))).toBe(2024);
    expect(fiscalYearOf(UK, g(2025, 4, 5))).toBe(2024);
    expect(fiscalYearOf(UK, g(2025, 1, 1))).toBe(2024);
  });

  it('end-named year from 1 July (Australian style): FY2025 is 2024-07-01..2025-06-30', () => {
    const r = fiscalYearRange(AU, 2025);
    expect(r.start).toEqual(g(2024, 7, 1));
    expect(r.end).toEqual(g(2025, 6, 30));
    expect(fiscalYearOf(AU, g(2024, 6, 30))).toBe(2024);
    expect(fiscalYearOf(AU, g(2024, 7, 1))).toBe(2025);
    expect(fiscalMonthIndex(AU, g(2025, 6, 30))).toBe(12);
    expect(fiscalMonthIndex(AU, g(2024, 7, 1))).toBe(1);
  });

  it('a year spanning a leap day has 366 days', () => {
    const r = fiscalYearRange(AU, 2024); // 2023-07-01 .. 2024-06-30 holds 29 Feb 2024
    expect(toEpochDay(r.endExclusive) - toEpochDay(r.start)).toBe(366);
    const r2 = fiscalYearRange(AU, 2025);
    expect(toEpochDay(r2.endExclusive) - toEpochDay(r2.start)).toBe(365);
  });

  it('accepts dates written in the other calendar', () => {
    // 1 Farvardin 1404 = 2025-03-21, in UK FY2024 (6 Apr 2024 .. 5 Apr 2025)
    expect(fiscalYearOf(UK, j(1404, 1, 1))).toBe(2024);
  });
});

describe('Jalali books starting mid-year', () => {
  it('1 Mehr start, named by the year it ends in', () => {
    const r = fiscalYearRange(JALALI_MEHR, 1404);
    expect(r.start).toEqual(j(1403, 7, 1));
    expect(r.end).toEqual(j(1404, 6, 31));
    expect(fiscalYearOf(JALALI_MEHR, j(1404, 6, 31))).toBe(1404);
    expect(fiscalYearOf(JALALI_MEHR, j(1404, 7, 1))).toBe(1405);
    expect(fiscalMonths(JALALI_MEHR, 1404)[5].end).toEqual(j(1403, 12, 30));
  });

  it('two calendars on one timeline: the same Gregorian day gets a year label in each spec', () => {
    const day = g(2025, 3, 20);
    expect(fiscalYearOf(IRAN_FISCAL_YEAR, day)).toBe(1403);
    expect(fiscalYearOf(GREGORIAN_CALENDAR_YEAR, day)).toBe(2025);
    expect(fiscalYearOf(JALALI_MEHR, day)).toBe(1404);
  });
});

describe('ranges and validation', () => {
  it('rangeContains is inclusive on both ends', () => {
    const r = fiscalYearRange(IRAN_FISCAL_YEAR, 1404);
    expect(rangeContains(r, j(1404, 1, 1))).toBe(true);
    expect(rangeContains(r, j(1404, 12, 29))).toBe(true);
    expect(rangeContains(r, j(1403, 12, 30))).toBe(false);
    expect(rangeContains(r, g(2026, 3, 21))).toBe(false);
    expect(rangeContains(r, g(2026, 3, 20))).toBe(true);
  });

  it('rejects impossible specs', () => {
    expect(() => assertFiscalSpec({ ...UK, startMonth: 0 })).toThrow();
    expect(() => assertFiscalSpec({ ...UK, startMonth: 13 })).toThrow();
    expect(() => assertFiscalSpec({ ...UK, startDay: 29 })).toThrow();
    expect(() => assertFiscalSpec({ ...UK, startDay: 0 })).toThrow();
    expect(() => assertFiscalSpec({ ...UK, labelBy: 'middle' as never })).toThrow();
    expect(() => assertFiscalSpec({ ...UK, calendar: 'hijri' as never })).toThrow();
    expect(() => fiscalYearRange({ ...UK, startDay: 31 }, 2024)).toThrow();
  });

  it('refuses years outside the supported range', () => {
    expect(() => fiscalYearRange(IRAN_FISCAL_YEAR, 1600)).toThrow();
    expect(() => fiscalYearRange(IRAN_FISCAL_YEAR, 1100)).toThrow();
  });
});

describe('CalendarService', () => {
  const svc = new CalendarService();

  it('is a thin, stateless facade over the pure functions', () => {
    expect(svc.convertIso('jalali', 'gregorian', '1403-12-30')).toBe('2025-03-20');
    expect(svc.convertIso('gregorian', 'jalali', '2025-03-21')).toBe('1404-01-01');
    expect(svc.parse('jalali', '1404-02-31')).toEqual(j(1404, 2, 31));
    expect(svc.format(g(2024, 2, 29))).toBe('2024-02-29');
    expect(svc.isLeapYear('jalali', 1408)).toBe(true);
    expect(svc.daysInMonth('jalali', 1404, 12)).toBe(29);
    expect(svc.daysInYear('gregorian', 2024)).toBe(366);
    expect(svc.addDays(j(1403, 12, 30), 1)).toEqual(j(1404, 1, 1));
    expect(svc.addMonths(j(1404, 6, 31), 1)).toEqual(j(1404, 7, 30));
    expect(svc.addYears(g(2024, 2, 29), 1)).toEqual(g(2025, 2, 28));
    expect(svc.diffDays(j(1404, 1, 1), j(1405, 1, 1))).toBe(365);
    expect(svc.endOfMonth('jalali', 1403, 12)).toEqual(j(1403, 12, 30));
    expect(svc.isoWeekday(g(2024, 3, 20))).toBe(3);
    expect(svc.isValid(j(1404, 12, 30))).toBe(false);
    expect(svc.iranFiscalYear).toEqual(IRAN_FISCAL_YEAR);
    expect(svc.fiscalYearOf(IRAN_FISCAL_YEAR, g(2025, 3, 21))).toBe(1404);
    expect(svc.fiscalQuarters(IRAN_FISCAL_YEAR, 1404)).toHaveLength(4);
    expect(svc.fiscalMonths(IRAN_FISCAL_YEAR, 1404)).toHaveLength(12);
    expect(svc.fiscalMonthIndex(IRAN_FISCAL_YEAR, j(1404, 3, 9))).toBe(3);
  });
});
