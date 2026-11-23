const TEHRAN_OFFSET_MS = 210 * 60 * 1000; // UTC+03:30 (no DST since 2022)

/**
 * Returns Gregorian YYYY-MM-DD representing the calendar date in Asia/Tehran timezone.
 * Uses fixed UTC+03:30 offset so it works identically on small-icu Node builds.
 */
export function tehranIsoDate(date: Date): string {
  const shifted = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
