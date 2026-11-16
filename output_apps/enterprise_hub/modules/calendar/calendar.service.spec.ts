import { CalendarService } from './calendar.service';
import { CalendarDate } from './calendar.types';

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService();
  });

  describe('parse', () => {
    it('should parse Jalali date correctly', () => {
      const date = service.parse('jalali', '1403-12-30');
      expect(date).toEqual({ calendar: 'jalali', year: 1403, month: 12, day: 30 });
    });

    it('should parse Gregorian date correctly', () => {
      const date = service.parse('gregorian', '2025-03-20');
      expect(date).toEqual({ calendar: 'gregorian', year: 2025, month: 3, day: 20 });
    });
  });

  describe('format', () => {
    it('should format Jalali date correctly', () => {
      const date: CalendarDate = { calendar: 'jalali', year: 1403, month: 12, day: 30 };
      expect(service.format(date)).toBe('1403-12-30');
    });

    it('should format Gregorian date correctly', () => {
      const date: CalendarDate = { calendar: 'gregorian', year: 2025, month: 3, day: 20 };
      expect(service.format(date)).toBe('2025-03-20');
    });
  });

  describe('isValid', () => {
    it('should validate Jalali date correctly', () => {
      const date: CalendarDate = { calendar: 'jalali', year: 1403, month: 12, day: 30 };
      expect(service.isValid(date)).toBe(true);
    });

    it('should validate Gregorian date correctly', () => {
      const date: CalendarDate = { calendar: 'gregorian', year: 2025, month: 3, day: 20 };
      expect(service.isValid(date)).toBe(true);
    });
  });

  describe('isLeapYear', () => {
    it('should correctly identify Jalali leap year', () => {
      expect(service.isLeapYear('jalali', 1403)).toBe(true);
    });

    it('should correctly identify Gregorian leap year', () => {
      expect(service.isLeapYear('gregorian', 2024)).toBe(true);
    });
  });

  describe('daysInMonth', () => {
    it('should return correct days for Jalali month', () => {
      expect(service.daysInMonth('jalali', 1403, 12)).toBe(30);
    });

    it('should return correct days for Gregorian month', () => {
      expect(service.daysInMonth('gregorian', 2025, 3)).toBe(31);
    });
  });

  describe('convert', () => {
    it('should convert Jalali to Gregorian correctly', () => {
      const jalaliDate: CalendarDate = { calendar: 'jalali', year: 1403, month: 12, day: 30 };
      const gregorianDate = service.convert(jalaliDate, 'gregorian');
      expect(gregorianDate).toEqual({ calendar: 'gregorian', year: 2025, month: 3, day: 20 });
    });

    it('should convert Gregorian to Jalali correctly', () => {
      const gregorianDate: CalendarDate = { calendar: 'gregorian', year: 2025, month: 3, day: 20 };
      const jalaliDate = service.convert(gregorianDate, 'jalali');
      expect(jalaliDate).toEqual({ calendar: 'jalali', year: 1403, month: 12, day: 30 });
    });
  });

  describe('convertIso', () => {
    it('should convert Jalali ISO to Gregorian ISO correctly', () => {
      expect(service.convertIso('jalali', 'gregorian', '1403-12-30')).toBe('2025-03-20');
    });

    it('should convert Gregorian ISO to Jalali ISO correctly', () => {
      expect(service.convertIso('gregorian', 'jalali', '2025-03-20')).toBe('1403-12-30');
    });
  });

  describe('explicit fiscal periods', () => {
    it('fiscalMonths supplies explicit Gregorian startDate and endDate', () => {
      const months = service.fiscalMonths(service.iranFiscalYear, 1405);
      expect(months).toHaveLength(12);
      expect(months[0].startDate).toBe('2026-03-21');
      expect(months[0].endDate).toBe('2026-04-20');
      expect(months[0].endDateExclusive).toBe('2026-04-21');
      expect(months[0].index).toBe(1);

      // Month 12 (Esfand) in 1405 (common year: 29 days)
      expect(months[11].startDate).toBe('2027-02-20');
      expect(months[11].endDate).toBe('2027-03-20');
      expect(months[11].endDateExclusive).toBe('2027-03-21');
      expect(months[11].index).toBe(12);
    });

    it('fiscalQuarters supplies explicit Gregorian startDate and endDate', () => {
      const quarters = service.fiscalQuarters(service.iranFiscalYear, 1405);
      expect(quarters).toHaveLength(4);
      expect(quarters[0].startDate).toBe('2026-03-21');
      expect(quarters[0].endDate).toBe('2026-06-21');
      expect(quarters[0].index).toBe(1);
    });

    it('fiscalYearRange supplies explicit Gregorian startDate and endDate', () => {
      const range = service.fiscalYearRange(service.iranFiscalYear, 1405);
      expect(range.startDate).toBe('2026-03-21');
      expect(range.endDate).toBe('2027-03-20');
      expect(range.endDateExclusive).toBe('2027-03-21');
    });
  });

  describe('timezone and instant helpers', () => {
    it('tehranIsoDate respects Asia/Tehran UTC+03:30 across UTC midnight', () => {
      // 2026-05-15 21:00:00 UTC is 2026-05-16 00:30:00 in Tehran
      const instant = new Date('2026-05-15T21:00:00.000Z');
      expect(service.tehranIsoDate(instant)).toBe('2026-05-16');

      // 2026-05-15 19:00:00 UTC is 2026-05-15 22:30:00 in Tehran
      const earlier = new Date('2026-05-15T19:00:00.000Z');
      expect(service.tehranIsoDate(earlier)).toBe('2026-05-15');
    });

    it('instantToIso converts instant to target calendar and timezone', () => {
      const instant = new Date('2026-03-20T21:00:00.000Z'); // 2026-03-21 00:30 in Tehran -> 1 Farvardin 1405
      expect(service.instantToIso(instant, 'jalali', 'Asia/Tehran')).toBe('1405-01-01');
    });

    it('formatJalali formats Gregorian string or CalendarDate into Jalali string', () => {
      expect(service.formatJalali('2026-03-21')).toBe('1405/01/01');
      expect(service.formatJalali('2026-03-21', '-')).toBe('1405-01-01');
      expect(service.formatJalali({ calendar: 'jalali', year: 1405, month: 1, day: 1 })).toBe('1405/01/01');
    });

    it('parseToJalali parses both Jalali and Gregorian strings', () => {
      expect(service.parseToJalali('1405/01/01')).toEqual({ calendar: 'jalali', year: 1405, month: 1, day: 1 });
      expect(service.parseToJalali('2026-03-21')).toEqual({ calendar: 'jalali', year: 1405, month: 1, day: 1 });
      expect(service.parseToJalali(null)).toBeNull();
      expect(service.parseToJalali('invalid')).toBeNull();
    });

    it('jalaliMonthRange returns correct Gregorian bounds and days', () => {
      const farvardin = service.jalaliMonthRange(1405, 1);
      expect(farvardin.days).toBe(31);
      expect(farvardin.startDate).toBe('2026-03-21');
      expect(farvardin.endDate).toBe('2026-04-20');

      const esfandCommon = service.jalaliMonthRange(1405, 12);
      expect(esfandCommon.days).toBe(29);
      expect(esfandCommon.startDate).toBe('2027-02-20');
      expect(esfandCommon.endDate).toBe('2027-03-20');

      const esfandLeap = service.jalaliMonthRange(1403, 12);
      expect(esfandLeap.days).toBe(30);
      expect(esfandLeap.startDate).toBe('2025-02-19');
      expect(esfandLeap.endDate).toBe('2025-03-20');
    });

    it('advanceJalaliMonths advances monthly template dates clamping to month length', () => {
      // 31 Farvardin 1405 is 2026-04-20 -> +1 month is 31 Ordibehesht 1405 (2026-05-21)
      expect(service.advanceJalaliMonths('2026-04-20', 1)).toBe('2026-05-21');
      // 31 Shahrivar 1405 is 2026-09-22 -> +1 month clamps to 30 Mehr 1405 (2026-10-22)
      expect(service.advanceJalaliMonths('2026-09-22', 1)).toBe('2026-10-22');
    });

    it('firstDayOfNextJalaliMonth gives the first day of next Jalali month in Gregorian', () => {
      // 15 Farvardin 1405 (2026-04-04) -> first day of next month is 1 Ordibehesht 1405 (2026-04-21)
      expect(service.firstDayOfNextJalaliMonth('2026-04-04')).toBe('2026-04-21');
      // 10 Esfand 1405 (2027-03-01) -> first day of next month is 1 Farvardin 1406 (2027-03-21)
      expect(service.firstDayOfNextJalaliMonth('2027-03-01')).toBe('2027-03-21');
    });

    it('jalaliQuarterRange computes quarter bounds with label', () => {
      const q1 = service.jalaliQuarterRange(1405, 1);
      expect(q1.startDate).toBe('2026-03-21');
      expect(q1.endDate).toBe('2026-06-21');
      expect(q1.label).toBe('1405/01/01 تا 1405/03/31');

      const q4 = service.jalaliQuarterRange(1405, 4);
      expect(q4.startDate).toBe('2026-12-22');
      expect(q4.endDate).toBe('2027-03-20');
      expect(q4.label).toBe('1405/10/01 تا 1405/12/29');
    });
  });
});
