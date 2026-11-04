import { jalaliMonthStart, jalaliMonthEnd, jalaliMonthDays, gregorianToJalali, compactJalali, isoDate } from './jalali-period'; 

describe('jalali-period', () => {
  describe('jalaliMonthStart', () => {
    it('returns first day of month 1 in 1399', () => {
      const date = jalaliMonthStart(1399, 1);
      expect(isoDate(date)).toBe('2020-03-21');
    });

    it('returns first day of month 12 in 1398 (non-leap year)', () => {
      const date = jalaliMonthStart(1398, 12);
      expect(isoDate(date)).toBe('2020-03-20');
    });

    it('returns first day of month 12 in 1399 (leap year)', () => {
      const date = jalaliMonthStart(1399, 12);
      expect(isoDate(date)).toBe('2020-03-21');
    });
  });

  describe('jalaliMonthEnd', () => {
    it('returns last day of month 1 in 1399', () => {
      const date = jalaliMonthEnd(1399, 1);
      expect(isoDate(date)).toBe('2020-04-20');
    });

    it('returns last day of month 12 in 1398 (non-leap year)', () => {
      const date = jalaliMonthEnd(1398, 12);
      expect(isoDate(date)).toBe('2020-03-19');
    });

    it('returns last day of month 12 in 1399 (leap year)', () => {
      const date = jalaliMonthEnd(1399, 12);
      expect(isoDate(date)).toBe('2020-03-20');
    });
  });

  describe('jalaliMonthDays', () => {
    it('returns 31 days for month 1 in 1399', () => {
      expect(jalaliMonthDays(1399, 1)).toBe(31);
    });

    it('returns 30 days for month 12 in 1398 (non-leap year)', () => {
      expect(jalaliMonthDays(1398, 12)).toBe(30);
    });

    it('returns 29 days for month 12 in 1399 (leap year)', () => {
      expect(jalaliMonthDays(1399, 12)).toBe(29);
    });
  });

  describe('gregorianToJalali', () => {
    it('converts 2020-03-21 to 1399-01-01', () => {
      expect(gregorianToJalali('2020-03-21')).toEqual({ jy: 1399, jm: 1, jd: 1 });
    });

    it('converts 2020-03-20 to 1398-12-30', () => {
      expect(gregorianToJalali('2020-03-20')).toEqual({ jy: 1398, jm: 12, jd: 30 });
    });

    it('converts 2020-03-21 to 1399-01-01', () => {
      expect(gregorianToJalali('2020-03-21')).toEqual({ jy: 1399, jm: 1, jd: 1 });
    });
  });

  describe('compactJalali', () => {
    it('returns empty string for null input', () => {
      expect(compactJalali(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(compactJalali(undefined)).toBe('');
    });

    it('converts 2020-03-21 to 13990101', () => {
      expect(compactJalali('2020-03-21')).toBe('13990101');
    });
  });

  describe('isoDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date(Date.UTC(2020, 2, 21));
      expect(isoDate(date)).toBe('2020-03-21');
    });
  });
});
