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
}
