import { jalaliToGregorian } from '../../data_import/normaliser/normalise';

/** Jalali calendar helpers for a payroll period (pure functions). */

const pad = (value: number, length = 2): string =>
  String(value).padStart(length, '0');

const toUtcDate = (parts: { gy: number; gm: number; gd: number }): Date =>
  new Date(Date.UTC(parts.gy, parts.gm - 1, parts.gd));

/** First day of a Jalali month as a UTC date. */
export function jalaliMonthStart(year: number, month: number): Date {
  return toUtcDate(jalaliToGregorian(year, month, 1));
}

/** Number of days in a Jalali month (31 / 30 / 29-30 for Esfand). */
export function jalaliMonthDays(year: number, month: number): number {
  const next =
    month === 12
      ? jalaliMonthStart(year + 1, 1)
      : jalaliMonthStart(year, month + 1);
  const start = jalaliMonthStart(year, month);
  return Math.round((next.getTime() - start.getTime()) / 86_400_000);
}

/** Last day of a Jalali month as a UTC date. */
export function jalaliMonthEnd(year: number, month: number): Date {
  const start = jalaliMonthStart(year, month);
  return new Date(
    start.getTime() + (jalaliMonthDays(year, month) - 1) * 86_400_000,
  );
}

/** Gregorian ISO date (`YYYY-MM-DD`) → Jalali parts, or `null` if invalid. */
export function gregorianToJalali(
  iso: string | null | undefined,
): { jy: number; jm: number; jd: number } | null {
  if (!iso) {
    return null;
  }
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const result = { jy: value('year'), jm: value('month'), jd: value('day') };
  return Number.isFinite(result.jy) ? result : null;
}

/** Gregorian ISO date → compact Jalali `YYYYMMDD` (SSO list format), or ''. */
export function compactJalali(iso: string | null | undefined): string {
  const j = gregorianToJalali(iso);
  return j ? `${pad(j.jy, 4)}${pad(j.jm)}${pad(j.jd)}` : '';
}

/** Gregorian ISO date (`YYYY-MM-DD`) of a UTC date. */
export function isoDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}
