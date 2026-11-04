import { BadRequestException } from '@nestjs/common';
import { jalaliQuarterRange } from './jalali-quarter.util';

const days = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 86_400_000);

describe('jalaliQuarterRange', () => {
  it('labels the four quarters of a normal year', () => {
    expect(jalaliQuarterRange(1404, 1).label).toBe('1404/01/01 تا 1404/03/31');
    expect(jalaliQuarterRange(1404, 2).label).toBe('1404/04/01 تا 1404/06/31');
    expect(jalaliQuarterRange(1404, 3).label).toBe('1404/07/01 تا 1404/09/30');
    expect(jalaliQuarterRange(1404, 4).label).toBe('1404/10/01 تا 1404/12/29');
  });

  it('ends quarter 4 on Esfand 30 in a leap year', () => {
    expect(jalaliQuarterRange(1403, 4).label).toBe('1403/10/01 تا 1403/12/30');
  });

  it('has the expected length in days', () => {
    expect(days(jalaliQuarterRange(1404, 1).from, jalaliQuarterRange(1404, 1).to)).toBe(93);
    expect(days(jalaliQuarterRange(1404, 3).from, jalaliQuarterRange(1404, 3).to)).toBe(90);
    expect(days(jalaliQuarterRange(1404, 4).from, jalaliQuarterRange(1404, 4).to)).toBe(89);
    expect(days(jalaliQuarterRange(1403, 4).from, jalaliQuarterRange(1403, 4).to)).toBe(90);
  });

  it('chains quarters with half-open bounds', () => {
    for (const q of [1, 2, 3]) {
      expect(jalaliQuarterRange(1404, q).to.getTime()).toBe(jalaliQuarterRange(1404, q + 1).from.getTime());
    }
    expect(jalaliQuarterRange(1404, 4).to.getTime()).toBe(jalaliQuarterRange(1405, 1).from.getTime());
  });

  it('rejects an invalid quarter', () => {
    expect(() => jalaliQuarterRange(1404, 0)).toThrow(BadRequestException);
    expect(() => jalaliQuarterRange(1404, 5)).toThrow(BadRequestException);
    expect(() => jalaliQuarterRange(1404, 1.5)).toThrow(BadRequestException);
  });

  it('rejects an implausible year', () => {
    expect(() => jalaliQuarterRange(1200, 1)).toThrow(BadRequestException);
    expect(() => jalaliQuarterRange(1700, 1)).toThrow(BadRequestException);
  });
});
