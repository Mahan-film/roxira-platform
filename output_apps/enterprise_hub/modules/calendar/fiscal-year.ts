import { addDays, addMonths, compare, convert, toEpochDay } from './calendar.math';
import {
  CALENDAR_IDS,
  CalendarDate,
  CalendarError,
  DateRange,
  FiscalPeriod,
  FiscalYearSpec,
} from './calendar.types';

/** Iran today: the fiscal year is the Jalali year, 1 Farvardin to the last day of Esfand. */
export const IRAN_FISCAL_YEAR: FiscalYearSpec = {
  calendar: 'jalali',
  startMonth: 1,
  startDay: 1,
  labelBy: 'start',
};

export function assertFiscalSpec(spec: FiscalYearSpec): void {
  if (!CALENDAR_IDS.includes(spec.calendar)) {
    throw new CalendarError(`unknown calendar "${String(spec.calendar)}"`);
  }
  if (!Number.isInteger(spec.startMonth) || spec.startMonth < 1 || spec.startMonth > 12) {
    throw new CalendarError('fiscal year startMonth must be 1..12');
  }
  if (!Number.isInteger(spec.startDay) || spec.startDay < 1 || spec.startDay > 28) {
    throw new CalendarError('fiscal year startDay must be 1..28');
  }
  if (spec.labelBy !== 'start' && spec.labelBy !== 'end') {
    throw new CalendarError('fiscal year labelBy must be "start" or "end"');
  }
}

/** A year that starts on the first day of the calendar year ends in the same calendar year. */
function startsOnNewYear(spec: FiscalYearSpec): boolean {
  return spec.startMonth === 1 && spec.startDay === 1;
}

/** Calendar year in which fiscal year `label` starts. */
function startYearOf(spec: FiscalYearSpec, label: number): number {
  return spec.labelBy === 'start' || startsOnNewYear(spec) ? label : label - 1;
}

function range(start: CalendarDate, endExclusive: CalendarDate): DateRange {
  return { start, end: addDays(endExclusive, -1), endExclusive };
}

export function fiscalYearRange(spec: FiscalYearSpec, label: number): DateRange {
  assertFiscalSpec(spec);
  const startYear = startYearOf(spec, label);
  const start: CalendarDate = {
    calendar: spec.calendar,
    year: startYear,
    month: spec.startMonth,
    day: spec.startDay,
  };
  return range(start, addMonths(start, 12));
}

/** The fiscal year (by label) that holds `date`, whatever calendar the date is written in. */
export function fiscalYearOf(spec: FiscalYearSpec, date: CalendarDate): number {
  assertFiscalSpec(spec);
  const local = convert(date, spec.calendar);
  const reached =
    local.month > spec.startMonth ||
    (local.month === spec.startMonth && local.day >= spec.startDay);
  const startYear = reached ? local.year : local.year - 1;
  return spec.labelBy === 'start' || startsOnNewYear(spec) ? startYear : startYear + 1;
}

/** Twelve consecutive calendar months from the start of the fiscal year. */
export function fiscalMonths(spec: FiscalYearSpec, label: number): FiscalPeriod[] {
  return fiscalPeriods(spec, label, 1);
}

/** Four quarters of three months. */
export function fiscalQuarters(spec: FiscalYearSpec, label: number): FiscalPeriod[] {
  return fiscalPeriods(spec, label, 3);
}

function fiscalPeriods(spec: FiscalYearSpec, label: number, months: number): FiscalPeriod[] {
  const { start } = fiscalYearRange(spec, label);
  const count = 12 / months;
  const result: FiscalPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const from = addMonths(start, i * months);
    result.push({ index: i + 1, ...range(from, addMonths(start, (i + 1) * months)) });
  }
  return result;
}

/** 1-based month index of `date` inside its fiscal year (1..12). */
export function fiscalMonthIndex(spec: FiscalYearSpec, date: CalendarDate): number {
  const label = fiscalYearOf(spec, date);
  const local = convert(date, spec.calendar);
  const day = toEpochDay(local);
  const months = fiscalMonths(spec, label);
  const found = months.find(
    (m) => day >= toEpochDay(m.start) && day < toEpochDay(m.endExclusive),
  );
  if (!found) {
    throw new CalendarError('date is not inside its own fiscal year');
  }
  return found.index;
}

export function rangeContains(r: DateRange, date: CalendarDate): boolean {
  return compare(r.start, date) <= 0 && compare(date, r.end) <= 0;
}
