import { tehranIsoDate } from '../../calendar/calendar.math';

/** Asia/Tehran helpers for attendance (real IANA tz via Intl, no hard-coded offset). */

const TEHRAN_TZ = 'Asia/Tehran';

/** Offset (ms) of Asia/Tehran from UTC at the given instant. */
function tehranOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Interprets a wall-clock time (as UTC fields) as Asia/Tehran and returns the real instant. */
function wallUtcMsToInstant(wallMs: number): number {
  let instant = wallMs - tehranOffsetMs(wallMs);
  instant = wallMs - tehranOffsetMs(instant);
  return instant;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tehran calendar date (`YYYY-MM-DD`) of an instant. */
export function tehranDateOf(instant: Date): string {
  return tehranIsoDate(instant);
}

/**
 * Half-open UTC window `[start, end)` covering the Asia/Tehran calendar day `dateStr`.
 * Returns null when `dateStr` is not a valid `YYYY-MM-DD` date.
 */
export function tehranDayWindow(dateStr: string): { start: Date; end: Date } | null {
  const m = DATE_RE.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  const start = wallUtcMsToInstant(Date.UTC(y, mo - 1, d));
  const end = wallUtcMsToInstant(Date.UTC(y, mo - 1, d + 1));
  return { start: new Date(start), end: new Date(end) };
}

/**
 * Parses `YYYY-MM-DD HH:mm[:ss]` (or with `T`) as Asia/Tehran wall time.
 * Returns null when malformed or not a real date/time.
 */
export function parseTehranWallTime(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  if (h > 23 || mi > 59 || s > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return new Date(wallUtcMsToInstant(probe.getTime()));
}
