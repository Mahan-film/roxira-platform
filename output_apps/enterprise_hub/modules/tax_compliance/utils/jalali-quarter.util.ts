import { BadRequestException } from '@nestjs/common';
import { tehranMidnight } from '../../assistant/services/jalali-period';

/** One Jalali fiscal quarter as a half-open range `[from, to)` in Tehran midnights. */
export interface JalaliQuarterRange {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  from: Date;
  to: Date;
  /** e.g. `1405/01/01 تا 1405/03/31` */
  label: string;
}

/** Days in a Jalali month: 31 for 1-6, 30 for 7-11, Esfand 29 or 30 (leap). */
function lastDayLabel(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  // Esfand has 30 days when the 1st of next Farvardin is 30 days after 1 Esfand.
  const days = Math.round(
    (tehranMidnight(year + 1, 1, 1).getTime() - tehranMidnight(year, 12, 1).getTime()) /
      86_400_000,
  );
  return days;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Quarter `q` of Jalali `year`: 1 = Farvardin–Khordad, 2 = Tir–Shahrivar,
 * 3 = Mehr–Azar, 4 = Dey–Esfand. The end bound is the first instant of the
 * next quarter, so an invoice issued at 23:59 on the last day is included and
 * one issued at 00:00 on the first day of the next quarter is not.
 */
export function jalaliQuarterRange(year: number, quarter: number): JalaliQuarterRange {
  if (!Number.isInteger(year) || year < 1300 || year > 1600) {
    throw new BadRequestException('سال شمسی نامعتبر است.');
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new BadRequestException('فصل باید عددی از ۱ تا ۴ باشد.');
  }
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const from = tehranMidnight(year, startMonth, 1);
  const to = quarter === 4 ? tehranMidnight(year + 1, 1, 1) : tehranMidnight(year, startMonth + 3, 1);
  return {
    year,
    quarter: quarter as 1 | 2 | 3 | 4,
    from,
    to,
    label: `${year}/${pad(startMonth)}/01 تا ${year}/${pad(endMonth)}/${pad(lastDayLabel(year, endMonth))}`,
  };
}
