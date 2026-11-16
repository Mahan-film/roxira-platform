import { Injectable } from '@nestjs/common';
import * as math from './calendar.math';
import {
  IRAN_FISCAL_YEAR,
  fiscalMonthIndex,
  fiscalMonths,
  fiscalQuarters,
  fiscalYearOf,
  fiscalYearRange,
} from './fiscal-year';
import {
  CalendarDate,
  CalendarId,
  DateRange,
  FiscalPeriod,
  FiscalYearSpec,
} from './calendar.types';

/**
 * The one place that converts dates and does period maths. Other modules call this service (or the
 * pure functions behind it) instead of keeping their own Jalali code. Stateless and clock-free.
 */
@Injectable()
export class CalendarService {
  readonly iranFiscalYear: FiscalYearSpec = IRAN_FISCAL_YEAR;

  parse(calendar: CalendarId, text: string): CalendarDate {
    return math.parseDate(calendar, text);
  }
  format(date: CalendarDate): string {
    return math.formatDate(date);
  }
  isValid(date: CalendarDate): boolean {
    return math.isValid(date);
  }
  isLeapYear(calendar: CalendarId, year: number): boolean {
    return math.isLeapYear(calendar, year);
  }
  daysInMonth(calendar: CalendarId, year: number, month: number): number {
    return math.daysInMonth(calendar, year, month);
  }
  daysInYear(calendar: CalendarId, year: number): number {
    return math.daysInYear(calendar, year);
  }
  convert(date: CalendarDate, to: CalendarId): CalendarDate {
    return math.convert(date, to);
  }
  /** Converts an ISO text date between calendars, e.g. Jalali 1403-12-30 to Gregorian 2025-03-20. */
  convertIso(from: CalendarId, to: CalendarId, text: string): string {
    return math.formatDate(math.convert(math.parseDate(from, text), to));
  }
  addDays(date: CalendarDate, days: number): CalendarDate {
    return math.addDays(date, days);
  }
  addMonths(date: CalendarDate, months: number): CalendarDate {
    return math.addMonths(date, months);
  }
  addYears(date: CalendarDate, years: number): CalendarDate {
    return math.addYears(date, years);
  }
  diffDays(a: CalendarDate, b: CalendarDate): number {
    return math.diffDays(a, b);
  }
  endOfMonth(calendar: CalendarId, year: number, month: number): CalendarDate {
    return math.endOfMonth(calendar, year, month);
  }
  isoWeekday(date: CalendarDate): number {
    return math.isoWeekday(date);
  }

  fiscalYearOf(spec: FiscalYearSpec, date: CalendarDate): number {
    return fiscalYearOf(spec, date);
  }
  fiscalYearRange(spec: FiscalYearSpec, label: number): DateRange {
    return fiscalYearRange(spec, label);
  }
  fiscalMonths(spec: FiscalYearSpec, label: number): FiscalPeriod[] {
    return fiscalMonths(spec, label);
  }
  fiscalQuarters(spec: FiscalYearSpec, label: number): FiscalPeriod[] {
    return fiscalQuarters(spec, label);
  }
  fiscalMonthIndex(spec: FiscalYearSpec, date: CalendarDate): number {
    return fiscalMonthIndex(spec, date);
  }

  /**
   * Gregorian ISO date (`YYYY-MM-DD`) of an instant in the Iran calendar day (Asia/Tehran).
   * Safe across UTC midnight boundaries (e.g. 00:30 Tehran time).
   */
  tehranIsoDate(instant: Date | string | number = new Date()): string {
    return math.tehranIsoDate(instant);
  }

  /**
   * Converts an instant to a Gregorian ISO string (`YYYY-MM-DD`) in the given timezone (default 'Asia/Tehran').
   */
  instantToGregorianIso(instant: Date | string | number, timeZone = 'Asia/Tehran'): string {
    return math.instantToGregorianIso(instant, timeZone);
  }

  /**
   * Converts an instant to an ISO string (`YYYY-MM-DD`) in the target calendar and timezone.
   */
  instantToIso(
    instant: Date | string | number,
    calendar: CalendarId = 'jalali',
    timeZone = 'Asia/Tehran',
  ): string {
    return math.instantToIso(instant, calendar, timeZone);
  }

  /**
   * Returns today's ISO date string in the target calendar and timezone.
   */
  todayIso(calendar: CalendarId = 'gregorian', timeZone = 'Asia/Tehran'): string {
    return math.todayIso(calendar, timeZone);
  }

  /**
   * Returns today's CalendarDate in the target calendar and timezone.
   */
  today(calendar: CalendarId = 'gregorian', timeZone = 'Asia/Tehran'): CalendarDate {
    return math.today(calendar, timeZone);
  }

  /**
   * Converts an instant (Date, timestamp, or string) to a CalendarDate in the target calendar and timezone.
   */
  instantToDate(
    instant: Date | string | number,
    calendar: CalendarId = 'gregorian',
    timeZone = 'Asia/Tehran',
  ): CalendarDate {
    return math.instantToDate(instant, calendar, timeZone);
  }

  /**
   * Formats a date or Gregorian ISO string into Jalali display text, e.g. "1405/01/15" or "1405-01-15".
   */
  formatJalali(dateOrIso: CalendarDate | string, separator: '/' | '-' = '/'): string {
    return math.formatJalali(dateOrIso, separator);
  }

  /**
   * Parse a date string (Jalali `YYYY/MM/DD` or Gregorian ISO `YYYY-MM-DD`) into Jalali CalendarDate.
   */
  parseToJalali(dateStr: string | null | undefined): CalendarDate | null {
    return math.parseToJalali(dateStr);
  }

  /**
   * Closed date range for a Jalali month with Gregorian ISO start and end strings and day count.
   */
  jalaliMonthRange(year: number, month: number): {
    start: CalendarDate;
    end: CalendarDate;
    startDate: string;
    endDate: string;
    days: number;
  } {
    return math.jalaliMonthRange(year, month);
  }

  /**
   * Number of days in a Jalali month.
   */
  jalaliMonthDays(year: number, month: number): number {
    return math.daysInMonth('jalali', year, month);
  }

  /**
   * First day of a Jalali month as a CalendarDate.
   */
  jalaliMonthStart(year: number, month: number): CalendarDate {
    return { calendar: 'jalali', year, month, day: 1 };
  }

  /**
   * Last day of a Jalali month as a CalendarDate.
   */
  jalaliMonthEnd(year: number, month: number): CalendarDate {
    return math.endOfMonth('jalali', year, month);
  }

  /**
   * Adds whole Jalali calendar months to a Gregorian ISO date string, keeping the day clamped.
   */
  advanceJalaliMonths(iso: string, months: number): string {
    return math.advanceJalaliMonths(iso, months);
  }

  /**
   * First day of the Jalali month following the one `iso` falls in, as Gregorian ISO.
   */
  firstDayOfNextJalaliMonth(iso: string): string {
    return math.firstDayOfNextJalaliMonth(iso);
  }

  /**
   * Closed date range for a Jalali quarter (1..4) in a given Jalali year.
   */
  jalaliQuarterRange(year: number, quarter: number): {
    year: number;
    quarter: number;
    startDate: string;
    endDate: string;
    label: string;
  } {
    return math.jalaliQuarterRange(year, quarter);
  }
}
