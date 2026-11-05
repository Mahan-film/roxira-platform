/** Pure helpers for the cheques pages (no React, no fetch), so they can be unit-tested with node --test. */
import type { Cheque, ChequeDirection, ChequeStatus, ReconState } from "@/types/cheques";

export const toLatinDigits = (value: string): string =>
  value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();

/** Same format check as the backend: 16 digits, not one repeated digit. No check digit is known publicly. */
export function isValidSayadNumber(value: string): boolean {
  return /^\d{16}$/.test(value) && !/^(\d)\1{15}$/.test(value);
}

/** Iranian national code (10 digits, mod 11) or legal-entity national id (11 digits, weighted). */
export function isValidNationalId(value: string): boolean {
  if (/^\d{10}$/.test(value)) {
    if (/^(\d)\1{9}$/.test(value)) return false;
    const d = value.split("").map(Number);
    const sum = d.slice(0, 9).reduce((s, x, i) => s + x * (10 - i), 0);
    const r = sum % 11;
    return (r < 2 ? r : 11 - r) === d[9];
  }
  if (/^\d{11}$/.test(value)) {
    const d = value.split("").map(Number);
    const offset = d[9] + 2;
    const weights = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
    const r = weights.reduce((s, w, i) => s + (d[i] + offset) * w, 0) % 11;
    return (r === 10 ? 0 : r) === d[10];
  }
  return false;
}

/** Statuses a cheque of this direction can ever have (for the filter menu). */
export function statusesFor(direction: ChequeDirection | "all"): ChequeStatus[] {
  const received: ChequeStatus[] = ["registered", "deposited", "cleared", "bounced", "returned", "spent"];
  const issued: ChequeStatus[] = ["registered", "delivered", "cleared", "bounced", "returned"];
  if (direction === "received") return received;
  if (direction === "issued") return issued;
  return ["registered", "delivered", "deposited", "cleared", "bounced", "returned", "spent"];
}

/**
 * Exact minor units (hundredths of a rial) of an amount given as text or number, or null when it is not
 * a plain decimal with at most 2 places. Comparisons use BigInt so amounts beyond 2^53 stay exact.
 */
// The frontend targets below ES2020, so BigInt literals (100n) are not allowed; build the constants instead.
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

export function toMinorUnits(value: string | number): bigint | null {
  const t = toLatinDigits(String(value)).replace(/[,٬\s]/g, "");
  const m = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]) * HUNDRED + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

/** A part can be paid while the cheque is still being collected and something remains. */
export function canPartialPay(cheque: Pick<Cheque, "direction" | "status" | "remainingAmount">): boolean {
  const remaining = toMinorUnits(cheque.remainingAmount);
  if (remaining === null || remaining <= ZERO) return false;
  return cheque.direction === "received"
    ? cheque.status === "registered" || cheque.status === "deposited"
    : cheque.status === "registered" || cheque.status === "delivered" || cheque.status === "bounced";
}

/** Client-side check before sending a partial payment: 0 < amount < remaining, at most 2 decimals. */
export function partialAmountError(text: string, remaining: number | string): string | null {
  const paid = toMinorUnits(text);
  const left = toMinorUnits(remaining);
  if (paid === null || paid <= ZERO) return "مبلغ باید عددی بزرگ‌تر از صفر با حداکثر دو رقم اعشار باشد.";
  if (left === null || paid >= left) return "مبلغ باید کمتر از مانده چک باشد؛ برای پرداخت کامل از «وصول/پاس شد» استفاده کنید.";
  return null;
}

export const RECON_STATE_LABELS: Record<ReconState, string> = {
  reconciled: "تطبیق‌شده",
  suggested: "پیشنهاد تطبیق",
  unmatched: "سطر مطابق در صورتحساب نیست",
  no_bank_line: "سند وصول روی حساب این بانک نیست",
};

export const BOUNCED_BUCKET_LABELS: Record<string, string> = {
  "0-30": "تا ۳۰ روز",
  "31-60": "۳۱ تا ۶۰ روز",
  "61-90": "۶۱ تا ۹۰ روز",
  "90+": "بیش از ۹۰ روز",
};

/** Due-report windows offered in the UI. */
export const DUE_WINDOWS = [7, 15, 30, 60, 90] as const;

/** Cheques that are overdue first, then by due date, for the list view. */
export function sortByUrgency<T extends { dueDate: string; status: ChequeStatus }>(rows: T[], today: string): T[] {
  const open = (r: T) => r.status === "registered" || r.status === "delivered" || r.status === "deposited" || r.status === "bounced";
  const rank = (r: T) => (open(r) ? (r.dueDate < today ? 0 : 1) : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.dueDate.localeCompare(b.dueDate));
}
