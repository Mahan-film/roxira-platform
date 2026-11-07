import { jalaliToGregorian } from '../../data_import/normaliser/normalise';
import {
  gregorianToJalali,
  isoDate,
  jalaliMonthDays,
  jalaliMonthStart,
} from '../../hr/services/jalali-period';

const toUtc = (parts: { gy: number; gm: number; gd: number }): Date =>
  new Date(Date.UTC(parts.gy, parts.gm - 1, parts.gd));

/**
 * Add whole Jalali calendar months to a Gregorian ISO day, keeping the day of the month and
 * clamping it to the target month's length (so 31 Farvardin + 1 month becomes 31 Ordibehesht,
 * but 31 Shahrivar + 1 month becomes 30 Mehr). This is what makes a monthly template on
 * 1 Farvardin next run on 1 Ordibehesht.
 */
export function advanceJalaliMonths(iso: string, months: number): string {
  const j = gregorianToJalali(iso);
  if (!j) {
    throw new Error(`Invalid date: ${iso}`);
  }
  const total = j.jy * 12 + (j.jm - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(j.jd, jalaliMonthDays(year, month));
  return isoDate(toUtc(jalaliToGregorian(year, month, day)));
}

/** First day of the Jalali month after the one `iso` falls in. */
export function firstDayOfNextJalaliMonth(iso: string): string {
  const j = gregorianToJalali(iso);
  if (!j) {
    throw new Error(`Invalid date: ${iso}`);
  }
  const year = j.jm === 12 ? j.jy + 1 : j.jy;
  const month = j.jm === 12 ? 1 : j.jm + 1;
  return isoDate(jalaliMonthStart(year, month));
}
