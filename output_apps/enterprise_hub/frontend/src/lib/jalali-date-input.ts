import {
  isoToJalaliParts,
  jalaliMonthLength,
  jalaliToIso,
} from "./jalali.ts";

const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function toPersianDigits(value: string): string {
  return value.replace(/\d/g, (d) => PERSIAN[Number(d)]);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Keep up to 8 digits and lay them out as yyyy/mm/dd (slashes appear once the next digit exists). */
export function maskJalaliInput(raw: string): string {
  const digits = toAsciiDigits(raw).replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean);
  return toPersianDigits(parts.join("/"));
}

export interface JalaliTextCheck {
  state: "empty" | "partial" | "valid" | "invalid";
  iso?: string;
  message?: string;
}

const INVALID_MESSAGE = "تاریخ شمسی معتبر نیست";

export function checkJalaliText(text: string): JalaliTextCheck {
  const digits = toAsciiDigits(text).replace(/\D/g, "");
  if (digits === "") return { state: "empty" };
  const invalid = { state: "invalid" as const, message: INVALID_MESSAGE };
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  if (year.length === 4 && (Number(year) < 1200 || Number(year) > 1600)) return invalid;
  if (month.length === 2 && (Number(month) < 1 || Number(month) > 12)) return invalid;
  if (day.length === 2 && (Number(day) < 1 || Number(day) > 31)) return invalid;
  if (digits.length < 8) return { state: "partial" };
  const iso = jalaliToIso(`${year}/${month}/${day}`);
  return iso ? { state: "valid", iso } : invalid;
}

function isoFromParts(jy: number, jm: number, jd: number): string | null {
  return jalaliToIso(`${jy}/${jm}/${jd}`);
}

function textFromParts(jy: number, jm: number, jd: number): string {
  return maskJalaliInput(`${jy}${pad2(jm)}${pad2(jd)}`);
}

/** Move a valid complete date by `delta` days, months or years; null when the text is not a valid date. */
export function stepJalaliText(
  text: string,
  unit: "day" | "month" | "year",
  delta: number,
): string | null {
  const check = checkJalaliText(text);
  if (check.state !== "valid" || !check.iso) return null;
  const parts = isoToJalaliParts(check.iso);
  if (!parts) return null;
  if (unit === "day") {
    const date = new Date(`${check.iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    const next = isoToJalaliParts(date.toISOString().slice(0, 10));
    return next ? textFromParts(next.jy, next.jm, next.jd) : null;
  }
  let { jy, jm } = parts;
  if (unit === "year") {
    jy += delta;
  } else {
    const index = jy * 12 + (jm - 1) + delta;
    jy = Math.floor(index / 12);
    jm = (index % 12 + 12) % 12 + 1;
  }
  const jd = Math.min(parts.jd, jalaliMonthLength(jy, jm));
  return isoFromParts(jy, jm, jd) ? textFromParts(jy, jm, jd) : null;
}

const TEHRAN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Gregorian ISO date of the current calendar day in Tehran (Iran has no daylight saving). */
export function todayJalaliIso(now: Date = new Date()): string {
  return TEHRAN_DAY.format(now);
}

export interface JalaliPreset {
  key: string;
  label: string;
  /** Gregorian ISO dates, inclusive. */
  from: string;
  to: string;
}

export function jalaliPresets(todayIso: string): JalaliPreset[] {
  const today = isoToJalaliParts(todayIso);
  if (!today) return [];
  const { jy, jm } = today;
  const year = toPersianDigits(String(jy));
  const range = (key: string, label: string, m1: number, d1: number, m2: number, d2?: number): JalaliPreset => ({
    key,
    label,
    from: isoFromParts(jy, m1, d1) ?? todayIso,
    to: isoFromParts(jy, m2, d2 ?? jalaliMonthLength(jy, m2)) ?? todayIso,
  });
  return [
    { key: "today", label: "امروز", from: todayIso, to: todayIso },
    range("month", "این ماه", jm, 1, jm),
    range("spring", `بهار ${year}`, 1, 1, 3),
    range("summer", `تابستان ${year}`, 4, 1, 6),
    range("autumn", `پاییز ${year}`, 7, 1, 9),
    range("winter", `زمستان ${year}`, 10, 1, 12),
    range("fiscal", `سال مالی ${year}`, 1, 1, 12),
  ];
}
