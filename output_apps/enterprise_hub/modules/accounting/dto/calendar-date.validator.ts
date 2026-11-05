import { registerDecorator, ValidationOptions } from 'class-validator';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real Gregorian day written as YYYY-MM-DD (year 0001-9999), e.g. not 2026-02-30. */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

/**
 * A date-only query value that Postgres `CAST(... AS date)` accepts: shape YYYY-MM-DD and a day
 * that exists in the calendar. Impossible days (2026-13-45, 2026-02-30) fail validation with a
 * 400 instead of reaching the database and raising 22008 (500). `label` is the Persian field name.
 */
export function IsCalendarDate(label: string, options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: {
        message: `«${label}» باید یک روز واقعی به شکل YYYY-MM-DD باشد.`,
        ...options,
      },
      validator: { validate: isCalendarDate },
    });
  };
}
