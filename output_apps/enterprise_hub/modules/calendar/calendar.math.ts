import { CalendarDate, CalendarError, CalendarId } from './calendar.types';

/**
 * Pure date arithmetic for the two supported calendars. Every date is first turned into an
 * "epoch day" (whole days since 1970-01-01, Gregorian), so all period maths is integer maths and no
 * clock, zone or `Date` object is involved.
 *
 * Jalali leap years follow the 33-year arithmetic rule `(25 * y + 11) mod 33 < 8`. It is checked
 * against the platform ICU data for every day of the supported range in calendar.math.spec.ts.
 * The rule and ICU first disagree in year 1502, and the published calendar is astronomical, so
 * years outside the range below are refused rather than guessed.
 */
export const JALALI_MIN_YEAR = 1206;
export const JALALI_MAX_YEAR = 1500;
export const GREGORIAN_MIN_YEAR = 1827;
export const GREGORIAN_MAX_YEAR = 2122;

const JALALI_MONTH_LENGTHS = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
const GREGORIAN_MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 1 Farvardin 1403 is 2024-03-20 (epoch day 19802). The Jalali anchor for all conversions. */
const ANCHOR_JALALI_YEAR = 1403;
const ANCHOR_EPOCH_DAY = 19802;

function assertInt(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    throw new CalendarError(`${what} must be an integer`);
  }
}

export function isGregorianLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isJalaliLeap(year: number): boolean {
  assertInt(year, 'year');
  return (((25 * year + 11) % 33) + 33) % 33 < 8;
}

export function isLeapYear(calendar: CalendarId, year: number): boolean {
  return calendar === 'jalali' ? isJalaliLeap(year) : isGregorianLeap(year);
}

export function yearRange(calendar: CalendarId): { min: number; max: number } {
  return calendar === 'jalali'
    ? { min: JALALI_MIN_YEAR, max: JALALI_MAX_YEAR }
    : { min: GREGORIAN_MIN_YEAR, max: GREGORIAN_MAX_YEAR };
}

export function daysInMonth(calendar: CalendarId, year: number, month: number): number {
  assertInt(year, 'year');
  assertInt(month, 'month');
  if (month < 1 || month > 12) {
    throw new CalendarError(`month ${month} is out of range 1..12`);
  }
  if (calendar === 'jalali') {
    return month === 12 && isJalaliLeap(year) ? 30 : JALALI_MONTH_LENGTHS[month - 1];
  }
  return month === 2 && isGregorianLeap(year) ? 29 : GREGORIAN_MONTH_LENGTHS[month - 1];
}

export function daysInYear(calendar: CalendarId, year: number): number {
  return isLeapYear(calendar, year) ? 366 : 365;
}

/** Throws unless the date exists in its calendar and inside the supported year range. */
export function assertValid(date: CalendarDate): void {
  const { min, max } = yearRange(date.calendar);
  assertInt(date.year, 'year');
  assertInt(date.month, 'month');
  assertInt(date.day, 'day');
  if (date.year < min || date.year > max) {
    throw new CalendarError(
      `${date.calendar} year ${date.year} is outside the supported range ${min}..${max}`,
    );
  }
  if (date.day < 1 || date.day > daysInMonth(date.calendar, date.year, date.month)) {
    throw new CalendarError(
      `${date.year}-${date.month}-${date.day} does not exist in the ${date.calendar} calendar`,
    );
  }
}

export function isValid(date: CalendarDate): boolean {
  try {
    assertValid(date);
    return true;
  } catch {
    return false;
  }
}

/** Gregorian civil date to epoch day (proleptic, days-from-civil algorithm). */
function gregorianToEpochDay(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function epochDayToGregorian(epochDay: number): { year: number; month: number; day: number } {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** Leap years among Jalali years 1..n (the rule repeats every 33 years with 8 leap years). */
const LEAPS_IN_CYCLE: number[] = (() => {
  const prefix = [0];
  for (let y = 1; y <= 33; y++) {
    prefix.push(prefix[y - 1] + (isJalaliLeap(y) ? 1 : 0));
  }
  return prefix;
})();

function jalaliLeapsUpTo(n: number): number {
  return Math.floor(n / 33) * 8 + LEAPS_IN_CYCLE[n % 33];
}

/** Days from 1 Farvardin of year 1 up to 1 Farvardin of `year`. */
function jalaliDaysBeforeYear(year: number): number {
  return 365 * (year - 1) + jalaliLeapsUpTo(year - 1);
}

function jalaliYearStartEpochDay(year: number): number {
  return (
    ANCHOR_EPOCH_DAY + jalaliDaysBeforeYear(year) - jalaliDaysBeforeYear(ANCHOR_JALALI_YEAR)
  );
}

function jalaliMonthOffset(month: number): number {
  let offset = 0;
  for (let m = 1; m < month; m++) offset += JALALI_MONTH_LENGTHS[m - 1];
  return offset;
}

/** Whole days since 1970-01-01 of a valid date. */
export function toEpochDay(date: CalendarDate): number {
  assertValid(date);
  if (date.calendar === 'gregorian') {
    return gregorianToEpochDay(date.year, date.month, date.day);
  }
  return jalaliYearStartEpochDay(date.year) + jalaliMonthOffset(date.month) + date.day - 1;
}

export function fromEpochDay(calendar: CalendarId, epochDay: number): CalendarDate {
  assertInt(epochDay, 'epochDay');
  let date: CalendarDate;
  if (calendar === 'gregorian') {
    date = { calendar, ...epochDayToGregorian(epochDay) };
  } else {
    let year = Math.floor((epochDay - ANCHOR_EPOCH_DAY) / 365.2425) + ANCHOR_JALALI_YEAR;
    while (jalaliYearStartEpochDay(year) > epochDay) year--;
    while (jalaliYearStartEpochDay(year + 1) <= epochDay) year++;
    let rest = epochDay - jalaliYearStartEpochDay(year);
    let month = 1;
    while (rest >= daysInMonth('jalali', year, month)) {
      rest -= daysInMonth('jalali', year, month);
      month++;
    }
    date = { calendar, year, month, day: rest + 1 };
  }
  assertValid(date);
  return date;
}

export function convert(date: CalendarDate, to: CalendarId): CalendarDate {
  assertValid(date);
  return date.calendar === to ? { ...date } : fromEpochDay(to, toEpochDay(date));
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  assertInt(days, 'days');
  return fromEpochDay(date.calendar, toEpochDay(date) + days);
}

/**
 * Adds calendar months; a day that does not exist in the target month moves to its last day
 * (31 Shahrivar plus one month is 30 Mehr, 29 Esfand in a common year plus 12 months stays 29).
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  assertValid(date);
  assertInt(months, 'months');
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  const day = Math.min(date.day, daysInMonth(date.calendar, year, month));
  const result: CalendarDate = { calendar: date.calendar, year, month, day };
  assertValid(result);
  return result;
}

export function addYears(date: CalendarDate, years: number): CalendarDate {
  return addMonths(date, years * 12);
}

/** Signed whole days from `a` to `b`; dates may be in different calendars. */
export function diffDays(a: CalendarDate, b: CalendarDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compare(a: CalendarDate, b: CalendarDate): -1 | 0 | 1 {
  const d = diffDays(a, b);
  return d > 0 ? -1 : d < 0 ? 1 : 0;
}

export function endOfMonth(calendar: CalendarId, year: number, month: number): CalendarDate {
  const date: CalendarDate = { calendar, year, month, day: daysInMonth(calendar, year, month) };
  assertValid(date);
  return date;
}

/** ISO weekday: Monday 1 .. Sunday 7 (1970-01-01 was a Thursday). */
export function isoWeekday(date: CalendarDate): number {
  return ((((toEpochDay(date) + 3) % 7) + 7) % 7) + 1;
}

/** Jalali week day: Saturday 0 .. Friday 6, the order Iranian calendars print. */
export function jalaliWeekday(date: CalendarDate): number {
  return (isoWeekday(date) + 1) % 7;
}

/** `YYYY-MM-DD` with ASCII digits; the calendar is not part of the text. */
export function formatDate(date: CalendarDate): string {
  assertValid(date);
  const p = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${p(date.year, 4)}-${p(date.month, 2)}-${p(date.day, 2)}`;
}

/** Parses `YYYY-MM-DD` or `YYYY/MM/DD` (ASCII digits only) as a date in `calendar`. */
export function parseDate(calendar: CalendarId, text: string): CalendarDate {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(text);
  if (!match) {
    throw new CalendarError(`"${text}" is not a YYYY-MM-DD date`);
  }
  const date: CalendarDate = {
    calendar,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  assertValid(date);
  return date;
}
