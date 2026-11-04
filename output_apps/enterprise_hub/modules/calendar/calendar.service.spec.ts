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
});
