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

/**
 * Converts an instant (Date, timestamp, or ISO string) to a Gregorian ISO string (`YYYY-MM-DD`)
 * in the given IANA timezone (default 'Asia/Tehran').
 */
export function instantToGregorianIso(
  instant: Date | string | number = new Date(),
  timeZone = 'Asia/Tehran',
): string {
  const d = typeof instant === 'string' || typeof instant === 'number' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) {
    throw new CalendarError(`Invalid instant: ${instant}`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/**
 * Returns a Gregorian ISO date string (`YYYY-MM-DD`) for an instant in the 'Asia/Tehran' timezone.
 */
export function tehranIsoDate(instant: Date | string | number = new Date()): string {
  return instantToGregorianIso(instant, 'Asia/Tehran');
}

/**
 * Converts an instant to a CalendarDate in the target calendar and timezone.
 */
export function instantToDate(
  instant: Date | string | number = new Date(),
  calendar: CalendarId = 'gregorian',
  timeZone = 'Asia/Tehran',
): CalendarDate {
  const iso = instantToGregorianIso(instant, timeZone);
  const greg = parseDate('gregorian', iso);
  return calendar === 'gregorian' ? greg : convert(greg, 'jalali');
}

/**
 * Converts an instant to an ISO string (`YYYY-MM-DD`) in the target calendar and timezone.
 */
export function instantToIso(
  instant: Date | string | number = new Date(),
  calendar: CalendarId = 'jalali',
  timeZone = 'Asia/Tehran',
): string {
  return formatDate(instantToDate(instant, calendar, timeZone));
}

/**
 * Returns today's CalendarDate in the target calendar and timezone.
 */
export function today(calendar: CalendarId = 'gregorian', timeZone = 'Asia/Tehran'): CalendarDate {
  return instantToDate(new Date(), calendar, timeZone);
}

/**
 * Returns today's ISO string (`YYYY-MM-DD`) in the target calendar and timezone.
 */
export function todayIso(calendar: CalendarId = 'gregorian', timeZone = 'Asia/Tehran'): string {
  return formatDate(today(calendar, timeZone));
}

/**
 * Formats a Gregorian ISO date string or CalendarDate into Jalali string `YYYY/MM/DD` or `YYYY-MM-DD`.
 */
export function formatJalali(dateOrIso: CalendarDate | string, separator: '/' | '-' = '/'): string {
  let jDate: CalendarDate;
  if (typeof dateOrIso === 'string') {
    const trimmed = dateOrIso.trim();
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
    if (!m) throw new CalendarError(`Invalid date string "${dateOrIso}"`);
    const y = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (y >= JALALI_MIN_YEAR && y <= JALALI_MAX_YEAR) {
      jDate = { calendar: 'jalali', year: y, month, day };
    } else {
      const greg: CalendarDate = { calendar: 'gregorian', year: y, month, day };
      jDate = convert(greg, 'jalali');
    }
  } else {
    jDate = dateOrIso.calendar === 'jalali' ? dateOrIso : convert(dateOrIso, 'jalali');
  }
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(jDate.year, 4)}${separator}${p(jDate.month, 2)}${separator}${p(jDate.day, 2)}`;
}

/**
 * Parses a date string (Jalali `YYYY/MM/DD` or Gregorian ISO `YYYY-MM-DD`) into a Jalali CalendarDate.
 */
export function parseToJalali(dateStr: string | null | undefined): CalendarDate | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  try {
    if (y >= JALALI_MIN_YEAR && y <= JALALI_MAX_YEAR) {
      const candidate: CalendarDate = { calendar: 'jalali', year: y, month, day };
      assertValid(candidate);
      return candidate;
    }
    if (y >= GREGORIAN_MIN_YEAR && y <= GREGORIAN_MAX_YEAR) {
      const greg: CalendarDate = { calendar: 'gregorian', year: y, month, day };
      assertValid(greg);
      return convert(greg, 'jalali');
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Closed date range for a Jalali month with Gregorian ISO start and end strings and day count.
 */
export function jalaliMonthRange(year: number, month: number): {
  start: CalendarDate;
  end: CalendarDate;
  startDate: string;
  endDate: string;
  days: number;
} {
  assertInt(year, 'year');
  assertInt(month, 'month');
  const days = daysInMonth('jalali', year, month);
  const start: CalendarDate = { calendar: 'jalali', year, month, day: 1 };
  const end: CalendarDate = { calendar: 'jalali', year, month, day: days };
  const gregStart = convert(start, 'gregorian');
  const gregEnd = convert(end, 'gregorian');
  return {
    start,
    end,
    startDate: formatDate(gregStart),
    endDate: formatDate(gregEnd),
    days,
  };
}

/**
 * Adds whole Jalali calendar months to a Gregorian ISO day, keeping the day clamped.
 */
export function advanceJalaliMonths(iso: string, months: number): string {
  const greg = parseDate('gregorian', iso);
  const j = convert(greg, 'jalali');
  const advanced = addMonths(j, months);
  return formatDate(convert(advanced, 'gregorian'));
}

/**
 * First day of the Jalali month following the one `iso` falls in, as Gregorian ISO.
 */
export function firstDayOfNextJalaliMonth(iso: string): string {
  const greg = parseDate('gregorian', iso);
  const j = convert(greg, 'jalali');
  const nextMonth = addMonths({ ...j, day: 1 }, 1);
  return formatDate(convert(nextMonth, 'gregorian'));
}

/**
 * Closed date range for a Jalali quarter (1..4) in a given Jalali year.
 */
export function jalaliQuarterRange(year: number, quarter: number): {
  year: number;
  quarter: number;
  startDate: string;
  endDate: string;
  label: string;
} {
  if (!Number.isInteger(year) || year < JALALI_MIN_YEAR || year > JALALI_MAX_YEAR) {
    throw new CalendarError(`سال شمسی نامعتبر است: ${year}`);
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new CalendarError(`فصل باید عددی از ۱ تا ۴ باشد: ${quarter}`);
  }
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const start: CalendarDate = { calendar: 'jalali', year, month: startMonth, day: 1 };
  const endDay = daysInMonth('jalali', year, endMonth);
  const end: CalendarDate = { calendar: 'jalali', year, month: endMonth, day: endDay };
  const gregStart = convert(start, 'gregorian');
  const gregEnd = convert(end, 'gregorian');
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    year,
    quarter,
    startDate: formatDate(gregStart),
    endDate: formatDate(gregEnd),
    label: `${year}/${pad(startMonth)}/01 تا ${year}/${pad(endMonth)}/${pad(endDay)}`,
  };
}

