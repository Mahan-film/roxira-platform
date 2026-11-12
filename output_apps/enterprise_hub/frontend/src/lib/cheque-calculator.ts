/**
 * Client-side Cheque Ras-giri (راس‌گیری) & Discounting (تنزیل) Calculator.
 * Uses BigInt minor units (via `toMinorUnits` in cheques-ui) and `formatMoneyRial`
 * from `fa-format` to avoid IEEE 754 precision loss.
 *
 * Past-due cheques keep negative day offsets in Ras-giri and accrue zero discount (days clamped to >= 0).
 */
import type { Cheque } from "@/types/cheques";
import { toLatinDigits, toMinorUnits } from "./cheques-ui.ts";
import { formatMoneyRial } from "./fa-format.ts";

const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const RATE_DENOMINATOR = BigInt(365) * BigInt(100) * BigInt(10000) * HUNDRED;

export interface ClientChequeItem {
  id?: string | number;
  amount: number | string;
  dueDate: string;
  sayadNumber?: string;
  description?: string;
}

export interface ClientChequeDetail {
  id?: string | number;
  amountDecimal: string;
  amountFormatted: string;
  dueDate: string;
  dueDateJalali: string;
  days: number;
  /** Display-only weight ratio percentage (not a money amount). */
  weightPercent: number;
  discountDecimal: string;
  discountFormatted: string;
  netPresentValueDecimal: string;
  netPresentValueFormatted: string;
  /** Display-only period discount rate ratio percentage (not a money amount). */
  effectivePeriodRatePercent: number;
  sayadNumber?: string;
  description?: string;
}

export interface ClientInvalidChequeItem {
  id?: string | number;
  reason: string;
}

export interface ClientRasgiriDiscountResult {
  totalAmountDecimal: string;
  totalAmountFormatted: string;
  totalTomanFormatted: string;
  totalCount: number;
  baseDate: string;
  baseDateJalali: string;
  weightedAverageDays: number;
  weightedMaturityDate: string;
  weightedMaturityJalali: string;
  annualRatePercent: number;
  totalDiscountDecimal: string;
  totalDiscountFormatted: string;
  totalDiscountTomanFormatted: string;
  netPresentValueDecimal: string;
  netPresentValueFormatted: string;
  netPresentValueTomanFormatted: string;
  items: ClientChequeDetail[];
  invalidItems: ClientInvalidChequeItem[];
}

/** Today's Gregorian YYYY-MM-DD in Asia/Tehran calendar day (never UTC). */
export function tehranTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Converts minor units (hundredths of a Rial) to exact decimal string ("1000" or "1000.50"). */
export function minorToRialString(minor: bigint): string {
  const negative = minor < ZERO;
  const abs = negative ? -minor : minor;
  const integer = abs / HUNDRED;
  const fraction = abs % HUNDRED;
  const prefix = negative ? "-" : "";
  if (fraction === ZERO) {
    return `${prefix}${integer.toString()}`;
  }
  return `${prefix}${integer.toString()}.${fraction.toString().padStart(2, "0")}`;
}

export function formatRialsFromMinor(minor: bigint): string {
  return formatMoneyRial(minorToRialString(minor), "rial");
}

export function formatTomansFromMinor(minor: bigint): string {
  return formatMoneyRial(minorToRialString(minor), "toman");
}

const OPEN_CALCULATOR_STATUSES = new Set(["registered", "delivered", "deposited", "bounced"]);

/** True only when a cheque has an open status matching server OPEN_STATUSES and positive remaining amount. */
export function isCalculatorEligibleCheque(
  cheque: Pick<Cheque, "status" | "remainingAmount" | "amount">,
): boolean {
  if (!OPEN_CALCULATOR_STATUSES.has(cheque.status)) {
    return false;
  }
  const effective = cheque.remainingAmount ?? cheque.amount;
  const minor = toMinorUnits(effective);
  return minor !== null && minor > ZERO;
}

/** Exact comparison between client calculation and server response using BigInt minor units. */
export function areCalculatorResultsEqual(
  client: Pick<ClientRasgiriDiscountResult, "totalAmountDecimal" | "weightedAverageDays" | "totalDiscountDecimal">,
  server: { totalAmount: number | string; weightedAverageDays: number; totalDiscountAmount: number | string },
): boolean {
  const clientAmount = toMinorUnits(client.totalAmountDecimal);
  const serverAmount = toMinorUnits(server.totalAmount);
  const clientDiscount = toMinorUnits(client.totalDiscountDecimal);
  const serverDiscount = toMinorUnits(server.totalDiscountAmount);
  if (clientAmount === null || serverAmount === null || clientDiscount === null || serverDiscount === null) {
    return false;
  }
  return (
    clientAmount === serverAmount &&
    client.weightedAverageDays === server.weightedAverageDays &&
    clientDiscount === serverDiscount
  );
}

/** Remaining amount to use in calculations (never falls back from 0 to face amount). */
export function effectiveChequeAmount(
  cheque: Pick<Cheque, "remainingAmount" | "amount">,
): number | string {
  return cheque.remainingAmount ?? cheque.amount;
}

export function diffDays(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = toYmd.slice(0, 10).split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return target.toISOString().slice(0, 10);
}

export function formatJalaliFromYmd(ymd: string): string {
  try {
    if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd;
    const parts = ymd.slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    if (Number.isNaN(date.getTime())) return ymd;
    const intlParts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const pick = (type: string) => intlParts.find((p) => p.type === type)?.value ?? "";
    return `${pick("year")}/${pick("month")}/${pick("day")}`;
  } catch {
    return ymd;
  }
}

function isValidYmdString(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (numerator >= ZERO) {
    return remainder * TWO >= denominator ? quotient + BigInt(1) : quotient;
  }
  return remainder * TWO <= -denominator ? quotient - BigInt(1) : quotient;
}

/** Parses annual percentage rate (0..100, up to 4 decimals) to BigInt scaled by 10^4 without floats. */
export function parseRateScaled(rateInput: number | string): bigint | null {
  const raw = toLatinDigits(String(rateInput ?? "")).trim();
  if (raw === "") return ZERO;
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(raw);
  if (!match) return null;
  const scaled = BigInt(match[1]) * BigInt(10000) + BigInt((match[2] ?? "").padEnd(4, "0"));
  if (scaled < ZERO || scaled > BigInt(100) * BigInt(10000)) return null;
  return scaled;
}

/**
 * Calculates Ras-giri and Discounting for a set of cheques using BigInt minor units.
 */
export function calculateClientRasgiriAndDiscount(
  items: ClientChequeItem[],
  annualRateInput: number | string = 0,
  baseDateInput?: string,
): ClientRasgiriDiscountResult {
  const baseDate =
    baseDateInput && isValidYmdString(baseDateInput.slice(0, 10))
      ? baseDateInput.slice(0, 10)
      : tehranTodayIso();

  const rateScaled = parseRateScaled(annualRateInput);
  const validRateScaled = rateScaled ?? ZERO;
  const annualRatePercent = Number(validRateScaled) / 10000;

  let totalAmountMinor = ZERO;
  let weightedProductSum = ZERO;

  const validItems: Array<{
    item: ClientChequeItem;
    amtMinor: bigint;
    dueDate: string;
    days: number;
  }> = [];
  const invalidItems: ClientInvalidChequeItem[] = [];

  for (const item of items) {
    const amtMinor = toMinorUnits(item.amount);
    const dueDate = item.dueDate.slice(0, 10);
    if (amtMinor === null || amtMinor <= ZERO) {
      invalidItems.push({ id: item.id, reason: "مبلغ چک باید عددی مثبت با حداکثر دو رقم اعشار باشد." });
      continue;
    }
    if (!isValidYmdString(dueDate)) {
      invalidItems.push({ id: item.id, reason: "تاریخ سررسید نامعتبر است." });
      continue;
    }
    const days = diffDays(baseDate, dueDate);
    validItems.push({ item, amtMinor, dueDate, days });
    totalAmountMinor += amtMinor;
    weightedProductSum += amtMinor * BigInt(days);
  }

  const avgDays =
    totalAmountMinor > ZERO ? Number(divRoundHalfUp(weightedProductSum, totalAmountMinor)) : 0;
  const weightedMaturityDate = addDaysYmd(baseDate, avgDays);

  let totalDiscountMinor = ZERO;
  const processedItems: ClientChequeDetail[] = validItems.map((vi) => {
    const effectiveDays = Math.max(0, vi.days);
    let discountMinor = ZERO;
    let periodRatePercent = 0;

    if (effectiveDays > 0 && validRateScaled > ZERO) {
      const numerator = vi.amtMinor * validRateScaled * BigInt(effectiveDays);
      discountMinor = divRoundHalfUp(numerator, RATE_DENOMINATOR) * HUNDRED;
      if (discountMinor > vi.amtMinor) discountMinor = vi.amtMinor;
      const periodBp = divRoundHalfUp(discountMinor * BigInt(10000), vi.amtMinor);
      periodRatePercent = Number(periodBp) / 100;
    }

    totalDiscountMinor += discountMinor;
    const npvMinor = vi.amtMinor - discountMinor;
    const weightBasis =
      totalAmountMinor > ZERO ? Number((vi.amtMinor * BigInt(10000)) / totalAmountMinor) : 0;

    return {
      id: vi.item.id,
      amountDecimal: minorToRialString(vi.amtMinor),
      amountFormatted: formatRialsFromMinor(vi.amtMinor),
      dueDate: vi.dueDate,
      dueDateJalali: formatJalaliFromYmd(vi.dueDate),
      days: vi.days,
      weightPercent: weightBasis / 100,
      discountDecimal: minorToRialString(discountMinor),
      discountFormatted: formatRialsFromMinor(discountMinor),
      netPresentValueDecimal: minorToRialString(npvMinor),
      netPresentValueFormatted: formatRialsFromMinor(npvMinor),
      effectivePeriodRatePercent: periodRatePercent,
      sayadNumber: vi.item.sayadNumber,
      description: vi.item.description,
    };
  });

  const netPresentValueMinor = totalAmountMinor - totalDiscountMinor;

  return {
    totalAmountDecimal: minorToRialString(totalAmountMinor),
    totalAmountFormatted: formatRialsFromMinor(totalAmountMinor),
    totalTomanFormatted: formatTomansFromMinor(totalAmountMinor),
    totalCount: validItems.length,
    baseDate,
    baseDateJalali: formatJalaliFromYmd(baseDate),
    weightedAverageDays: avgDays,
    weightedMaturityDate,
    weightedMaturityJalali: formatJalaliFromYmd(weightedMaturityDate),
    annualRatePercent,
    totalDiscountDecimal: minorToRialString(totalDiscountMinor),
    totalDiscountFormatted: formatRialsFromMinor(totalDiscountMinor),
    totalDiscountTomanFormatted: formatTomansFromMinor(totalDiscountMinor),
    netPresentValueDecimal: minorToRialString(netPresentValueMinor),
    netPresentValueFormatted: formatRialsFromMinor(netPresentValueMinor),
    netPresentValueTomanFormatted: formatTomansFromMinor(netPresentValueMinor),
    items: processedItems,
    invalidItems,
  };
}
