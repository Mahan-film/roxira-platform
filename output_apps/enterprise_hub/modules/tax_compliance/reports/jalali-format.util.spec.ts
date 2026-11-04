import { formatJalaliYmd, tehranDay } from './jalali-format.util';

describe('jalali-format.util', () => {
  describe('formatJalaliYmd', () => {
    it('formats a Gregorian date as Jalali YYYY/MM/DD', () => {
      expect(formatJalaliYmd(new Date('2026-05-01T00:00:00Z'))).toBe('1405/02/11');
    });

    it('keeps the previous Jalali year on the day before Nowruz', () => {
      // 1404 is a common year, so its last day is Esfand 29.
      expect(formatJalaliYmd(new Date('2026-03-20T00:00:00Z'))).toBe('1404/12/29');
    });

    it('starts the next Jalali year on the Nowruz boundary', () => {
      expect(formatJalaliYmd(new Date('2026-03-21T00:00:00Z'))).toBe('1405/01/01');
    });

    it('formats an Esfand 29 date in a common year', () => {
      expect(formatJalaliYmd(new Date('2025-03-19T00:00:00Z'))).toBe('1403/12/29');
    });

    it('formats an Esfand 30 date in a leap year', () => {
      expect(formatJalaliYmd(new Date('2025-03-20T00:00:00Z'))).toBe('1403/12/30');
    });

    it('rejects an invalid date', () => {
      expect(() => formatJalaliYmd(new Date('invalid'))).toThrow();
    });
  });

  describe('tehranDay', () => {
    it('formats an instant as the Tehran calendar day YYYY-MM-DD', () => {
      expect(tehranDay(new Date('2026-05-01T00:00:00Z'))).toBe('2026-05-01');
    });

    it('rolls over at midnight in Tehran (UTC+03:30)', () => {
      expect(tehranDay(new Date('2026-05-01T20:29:00Z'))).toBe('2026-05-01');
      expect(tehranDay(new Date('2026-05-01T20:30:00Z'))).toBe('2026-05-02');
    });

    it('rejects an invalid date', () => {
      expect(() => tehranDay(new Date('invalid'))).toThrow();
    });
  });
});
