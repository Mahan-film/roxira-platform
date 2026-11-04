import { jalaliQuarterRange } from './jalali-quarter.util';

describe('jalaliQuarterRange', () => {
  it('should return correct range for quarter 1', () => {
    const result = jalaliQuarterRange(1403, 1);
    expect(result).toEqual({
      year: 1403,
      quarter: 1,
      from: new Date('2024-03-20T20:30:00.000Z'),
      to: new Date('2024-06-20T20:30:00.000Z'),
      label: '1403/01/01 تا 1403/03/31',
    });
  });

  it('should return correct range for quarter 2', () => {
    const result = jalaliQuarterRange(1403, 2);
    expect(result).toEqual({
      year: 1403,
      quarter: 2,
      from: new Date('2024-06-20T20:30:00.000Z'),
      to: new Date('2024-09-20T20:30:00.000Z'),
      label: '1403/04/01 تا 1403/06/31',
    });
  });

  it('should return correct range for quarter 3', () => {
    const result = jalaliQuarterRange(1403, 3);
    expect(result).toEqual({
      year: 1403,
      quarter: 3,
      from: new Date('2024-09-20T20:30:00.000Z'),
      to: new Date('2024-12-20T20:30:00.000Z'),
      label: '1403/07/01 تا 1403/09/30',
    });
  });

  it('should return correct range for quarter 4 in a leap year', () => {
    const result = jalaliQuarterRange(1403, 4);
    expect(result).toEqual({
      year: 1403,
      quarter: 4,
      from: new Date('2024-12-20T20:30:00.000Z'),
      to: new Date('2025-03-20T20:30:00.000Z'),
      label: '1403/10/01 تا 1403/12/30',
    });
  });

  it('should return correct range for quarter 4 in a normal year', () => {
    const result = jalaliQuarterRange(1404, 4);
    expect(result).toEqual({
      year: 1404,
      quarter: 4,
      from: new Date('2025-12-20T20:30:00.000Z'),
      to: new Date('2026-03-20T20:30:00.000Z'),
      label: '1404/10/01 تا 1404/12/29',
    });
  });

  it('should throw error for invalid quarter 0', () => {
    expect(() => jalaliQuarterRange(1403, 0)).toThrow('فصل باید عددی از ۱ تا ۴ باشد.');
  });

  it('should throw error for invalid quarter 5', () => {
    expect(() => jalaliQuarterRange(1403, 5)).toThrow('فصل باید عددی از ۱ تا ۴ باشد.');
  });
});