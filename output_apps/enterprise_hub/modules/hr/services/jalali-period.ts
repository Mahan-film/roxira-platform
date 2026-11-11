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

const TEHRAN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Gregorian ISO date (`YYYY-MM-DD`) of an instant in the Iran calendar day (Asia/Tehran).
 * Use this, not `isoDate`, for "what legal date is it now": `isoDate` reads UTC, which is still
 * the previous day between 00:00 and 03:30 Tehran time.
 */
export function tehranIsoDate(date: Date): string {
  const parts = TEHRAN_DAY.formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Gregorian ISO date (`YYYY-MM-DD`) of a UTC date. */
export function isoDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

/** Parse a date string (Jalali `YYYY/MM/DD` or Gregorian ISO `YYYY-MM-DD`) into Jalali parts { jy, jm, jd }. */
export function parseDateToJalali(dateStr: string | null | undefined): { jy: number; jm: number; jd: number } | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const jMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (jMatch) {
    const y = Number(jMatch[1]);
    const m = Number(jMatch[2]);
    const d = Number(jMatch[3]);
    if (y >= 1300 && y <= 1500) {
      return { jy: y, jm: m, jd: d };
    }
  }
  return gregorianToJalali(trimmed);
}

/** Check if a leave date range overlaps with the given Jalali payroll period. */
export function isLeaveInPeriod(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  periodYear: number,
  periodMonth: number,
): boolean {
  if (!startDate || !endDate) return false;
  const s = parseDateToJalali(startDate);
  const e = parseDateToJalali(endDate);
  if (!s || !e) return false;

  const startInt = s.jy * 10000 + s.jm * 100 + s.jd;
  const endInt = e.jy * 10000 + e.jm * 100 + e.jd;
  const monthDays = jalaliMonthDays(periodYear, periodMonth);
  const periodStart = periodYear * 10000 + periodMonth * 100 + 1;
  const periodEnd = periodYear * 10000 + periodMonth * 100 + monthDays;

  return startInt <= periodEnd && endInt >= periodStart;
}

/**
 * Calculate the number of overlapping days between a leave request and a Jalali payroll period.
 * Prorates leaves that span multiple months so days are not deducted repeatedly.
 */
export function leaveDaysInPeriod(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  periodYear: number,
  periodMonth: number,
  totalLeaveDays?: number,
): number {
  if (!startDate || !endDate) return 0;
  const s = parseDateToJalali(startDate);
  const e = parseDateToJalali(endDate);
  if (!s || !e) return 0;

  const startInt = s.jy * 10000 + s.jm * 100 + s.jd;
  const endInt = e.jy * 10000 + e.jm * 100 + e.jd;
  if (endInt < startInt) return 0;

  const monthDays = jalaliMonthDays(periodYear, periodMonth);
  const periodStart = periodYear * 10000 + periodMonth * 100 + 1;
  const periodEnd = periodYear * 10000 + periodMonth * 100 + monthDays;

  if (startInt > periodEnd || endInt < periodStart) return 0;

  const overlapStart = Math.max(startInt, periodStart);
  const overlapEnd = Math.min(endInt, periodEnd);

  const overlapStartDay = overlapStart % 100;
  const overlapEndDay = overlapEnd % 100;
  const days = overlapEndDay - overlapStartDay + 1;

  if (totalLeaveDays !== undefined && totalLeaveDays > 0) {
    return Math.min(days, totalLeaveDays);
  }
  return Math.max(0, days);
}
