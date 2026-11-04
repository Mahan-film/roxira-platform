/** Calendars the platform can keep dates and fiscal years in. */
export const CALENDAR_IDS = ['jalali', 'gregorian'] as const;
export type CalendarId = (typeof CALENDAR_IDS)[number];

/** A civil date in one calendar. Month is 1-based. No time, no zone: dates are stored as ISO text. */
export interface CalendarDate {
  calendar: CalendarId;
  year: number;
  month: number;
  day: number;
}

/**
 * Where a fiscal year starts, in the calendar the company keeps its books in. `startDay` is limited
 * to 1..28 so that the start exists in every month of every year.
 */
export interface FiscalYearSpec {
  calendar: CalendarId;
  startMonth: number;
  startDay: number;
  /** Which calendar year names a fiscal year that spans two: the one it starts in or ends in. */
  labelBy: 'start' | 'end';
}

/** A closed date range in one calendar; `endExclusive` is the day after `end`. */
export interface DateRange {
  start: CalendarDate;
  end: CalendarDate;
  endExclusive: CalendarDate;
}

export interface FiscalPeriod extends DateRange {
  /** 1-based index inside the fiscal year. */
  index: number;
}

export class CalendarError extends Error {}
