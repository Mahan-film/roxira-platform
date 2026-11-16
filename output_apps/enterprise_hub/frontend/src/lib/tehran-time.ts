const TEHRAN_TZ = "Asia/Tehran";

/** Offset (ms) of Asia/Tehran from UTC at the given instant. */
function tehranOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEHRAN_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Converts a wall-clock date (YYYY-MM-DD) and time (HH:mm) entered by the user into the real UTC
 * instant (ISO string), reading the wall time as Asia/Tehran regardless of the browser time zone.
 * Returns null when the input is not a valid date/time.
 */
export function tehranWallTimeToIso(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wall)) return null;
  let instant = wall - tehranOffsetMs(wall);
  instant = wall - tehranOffsetMs(instant);
  return new Date(instant).toISOString();
}
