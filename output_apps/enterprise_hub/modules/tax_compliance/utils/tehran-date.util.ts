const TEHRAN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns Gregorian YYYY-MM-DD representing the calendar date in Asia/Tehran timezone.
 * Pure utility function without external module dependencies.
 */
export function tehranIsoDate(date: Date): string {
  const parts = TEHRAN_DAY.formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
