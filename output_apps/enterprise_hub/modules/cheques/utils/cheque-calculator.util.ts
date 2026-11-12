import { BadRequestException } from '@nestjs/common';
import { MoneyFormatError, fromMinor, parseScaled, toMinor } from '../../accounting/money';
import { tehranIsoDate } from '../../hr/services/jalali-period';

/**
 * Cheque Ras-giri (راس‌گیری چک) and Discounting (تنزیل چک) Calculator Utility.
 * Uses `modules/accounting/money.ts` BigInt minor units to avoid IEEE 754 precision loss.
 *
 * Past-due cheques:
 * - Weighted maturity (راس‌گیری) preserves negative day offsets relative to `baseDate`.
 * - Discounting (تنزیل) clamps effective remaining days to `>= 0` (already-matured cheques accrue 0 discount).
 */

export interface ChequeCalculationInput {
  id?: string | number;
  amount: number | string;
  dueDate: Date | string;
  sayadNumber?: string;
  description?: string;
}

export interface ChequeCalculationItemDetail {
  id?: string | number;
  amount: string;
  dueDate: string;
  dueDateJalali: string;
  days: number;
  weightPercent: number;
  sayadNumber?: string;
  description?: string;
}

export interface RasgiriResult {
  totalAmount: string;
  totalCount: number;
  baseDate: string;
  baseDateJalali: string;
  weightedAverageDays: number;
  weightedMaturityDate: string;
  weightedMaturityJalali: string;
  items: ChequeCalculationItemDetail[];
}

export interface ChequeDiscountItemDetail {
  id?: string | number;
  amount: string;
  dueDate: string;
  days: number;
  discountAmount: string;
  netPresentValue: string;
  effectivePeriodRatePercent: number;
}

export interface DiscountResult {
  totalAmount: string;
  totalDiscountAmount: string;
  netPresentValue: string;
  annualRatePercent: number;
  baseDate: string;
  weightedAverageDays: number;
  items: ChequeDiscountItemDetail[];
}

const HUNDRED_BIG = 100n;
const RATE_SCALE = 4;
const RATE_DENOMINATOR = 365n * 100n * 10000n; // 365 days * 100 percent * 10^4 rate scale

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new BadRequestException('مخرج تقسیم باید مثبت باشد.');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (numerator >= 0n) {
    return remainder * 2n >= denominator ? quotient + 1n : quotient;
  }
  return remainder * 2n <= -denominator ? quotient - 1n : quotient;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Converts Date or string to YYYY-MM-DD (using Asia/Tehran calendar day for Date / TZ-aware instants). */
export function normalizeDateToYmd(dateInput: Date | string): string {
  if (typeof dateInput === 'string') {
    const trimmed = toAsciiDigits(dateInput.trim());
    // Plain date or timestamp without explicit timezone offset preserves its calendar YYYY-MM-DD.
    // TZ-qualified ISO strings (Z or ±HH:MM) fall through to tehranIsoDate so they match Date inputs.
    const hasExplicitTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    const datePrefix = !hasExplicitTz ? /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(trimmed) : null;
    if (datePrefix) {
      const y = Number(datePrefix[1]);
      const m = Number(datePrefix[2]);
      const d = Number(datePrefix[3]);
      if (!isValidYmd(y, m, d)) {
        throw new BadRequestException(`تاریخ نامعتبر است: ${dateInput}`);
      }
      return `${datePrefix[1]}-${datePrefix[2]}-${datePrefix[3]}`;
    }
  }
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`تاریخ نامعتبر است: ${dateInput}`);
  }
  return tehranIsoDate(d);
}

/** Formats Gregorian YYYY-MM-DD into Jalali YYYY/MM/DD */
export function formatToJalali(ymd: string): string {
  const parts = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const intlParts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => intlParts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')}`;
}

/** Difference in integer days between two YYYY-MM-DD dates (to - from) */
export function diffInDays(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split('-').map(Number);
  const [y2, m2, d2] = toYmd.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

/** Adds integer days to YYYY-MM-DD returning YYYY-MM-DD */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return target.toISOString().slice(0, 10);
}

/**
 * Parses a Rial amount (number or decimal string, up to 2 decimals) into minor units via `money.ts`.
 * Normalizes Persian/Arabic digits and thousand separators before delegating to `toMinor`.
 */
export function toCalculatorMinor(amount: number | string): bigint {
  try {
    if (typeof amount === 'number') {
      return toMinor(amount);
    }
    const normalized = toAsciiDigits(String(amount)).trim().replace(/[,٬_\s]/g, '');
    return toMinor(normalized);
  } catch (err) {
    if (err instanceof MoneyFormatError) {
      throw new BadRequestException(`مبلغ نامعتبر است: ${amount}`);
    }
    throw err;
  }
}

function formatMinorRial(minor: bigint): string {
  return String(fromMinor(minor));
}

function parseRatePercentScaled(annualRatePercent: number | string): bigint {
  if (typeof annualRatePercent === 'number') {
    if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0 || annualRatePercent > 100) {
      throw new BadRequestException('نرخ تنزیل سالانه باید عددی بین ۰ تا ۱۰۰ باشد.');
    }
  }
  try {
    const scaled = parseScaled(annualRatePercent, RATE_SCALE);
    if (scaled < 0n || scaled > 100n * 10000n) {
      throw new BadRequestException('نرخ تنزیل سالانه باید عددی بین ۰ تا ۱۰۰ باشد.');
    }
    return scaled;
  } catch (err) {
    if (err instanceof MoneyFormatError) {
      throw new BadRequestException(`نرخ تنزیل سالانه نامعتبر است: ${annualRatePercent}`);
    }
    throw err;
  }
}

/**
 * Calculates Ras-giri (Weighted average maturity) for a list of cheques.
 * Formula:
 * Average Days = Sum(Amount_i * Days_i) / Sum(Amount_i)
 */
export function calculateRasgiri(
  items: ChequeCalculationInput[],
  baseDateInput?: Date | string,
): RasgiriResult {
  if (!items || items.length === 0) {
    throw new BadRequestException('حداقل یک فقره چک برای محاسبه راس‌گیری الزامی است.');
  }

  const baseDate = baseDateInput
    ? normalizeDateToYmd(baseDateInput)
    : tehranIsoDate(new Date());

  let totalAmountMinor = 0n;
  const processedItems = items.map((item) => {
    const amtMinor = toCalculatorMinor(item.amount);
    if (amtMinor <= 0n) {
      throw new BadRequestException(`مبلغ چک باید مثبت و بزرگ‌تر از صفر باشد: ${item.amount}`);
    }
    const dueYmd = normalizeDateToYmd(item.dueDate);
    const days = diffInDays(baseDate, dueYmd);
    totalAmountMinor += amtMinor;
    return {
      item,
      amtMinor,
      dueYmd,
      days,
    };
  });

  if (totalAmountMinor <= 0n) {
    throw new BadRequestException('مجموع مبالغ چک‌ها باید بزرگ‌تر از صفر باشد.');
  }

  let weightedProductSum = 0n;
  for (const pi of processedItems) {
    weightedProductSum += pi.amtMinor * BigInt(pi.days);
  }

  const avgDays = Number(divRoundHalfUp(weightedProductSum, totalAmountMinor));
  const weightedMaturityDate = addDaysToYmd(baseDate, avgDays);

  const itemDetails: ChequeCalculationItemDetail[] = processedItems.map((pi) => {
    const weightBasis = Number((pi.amtMinor * 10000n) / totalAmountMinor);
    return {
      id: pi.item.id,
      amount: formatMinorRial(pi.amtMinor),
      dueDate: pi.dueYmd,
      dueDateJalali: formatToJalali(pi.dueYmd),
      days: pi.days,
      weightPercent: weightBasis / 100,
      sayadNumber: pi.item.sayadNumber,
      description: pi.item.description,
    };
  });

  return {
    totalAmount: formatMinorRial(totalAmountMinor),
    totalCount: items.length,
    baseDate,
    baseDateJalali: formatToJalali(baseDate),
    weightedAverageDays: avgDays,
    weightedMaturityDate,
    weightedMaturityJalali: formatToJalali(weightedMaturityDate),
    items: itemDetails,
  };
}

/**
 * Calculates discounting for a single cheque amount.
 * Formula (365-day year, rounded half-up to nearest Rial):
 * Discount Amount = round((Amount * RatePercent * max(0, Days)) / (365 * 100))
 * Net Present Value = Amount - Discount Amount
 */
export function calculateSingleDiscount(
  amountInput: number | string,
  days: number,
  annualRatePercent: number,
): {
  discountAmount: string;
  netPresentValue: string;
  discountMinor: bigint;
  netPresentValueMinor: bigint;
  effectivePeriodRatePercent: number;
} {
  const amtMinor = toCalculatorMinor(amountInput);
  if (amtMinor <= 0n) {
    throw new BadRequestException('مبلغ چک برای محاسبه تنزیل باید بزرگ‌تر از صفر باشد.');
  }
  if (!Number.isFinite(days)) {
    throw new BadRequestException('تعداد روز نامعتبر است.');
  }
  const rateScaled = parseRatePercentScaled(annualRatePercent);

  // If days <= 0 (cheque already matured or past due), discount is 0
  const effectiveDays = Math.max(0, Math.trunc(days));
  if (effectiveDays === 0 || rateScaled === 0n) {
    return {
      discountAmount: '0',
      netPresentValue: formatMinorRial(amtMinor),
      discountMinor: 0n,
      netPresentValueMinor: amtMinor,
      effectivePeriodRatePercent: 0,
    };
  }

  // amtMinor is Rials * 100. Dividing by (RATE_DENOMINATOR * 100n) rounds to whole Rials,
  // then multiplying by 100n yields exact minor units aligned to whole Rials.
  const numerator = amtMinor * rateScaled * BigInt(effectiveDays);
  const rialDenominator = RATE_DENOMINATOR * HUNDRED_BIG;
  let discountMinor = divRoundHalfUp(numerator, rialDenominator) * HUNDRED_BIG;

  if (discountMinor > amtMinor) {
    discountMinor = amtMinor;
  }

  const npvMinor = amtMinor - discountMinor;
  const periodBasisPoints = divRoundHalfUp(discountMinor * 10000n, amtMinor);

  return {
    discountAmount: formatMinorRial(discountMinor),
    netPresentValue: formatMinorRial(npvMinor),
    discountMinor,
    netPresentValueMinor: npvMinor,
    effectivePeriodRatePercent: Number(periodBasisPoints) / 100,
  };
}

/**
 * Calculates discounting for a list/portfolio of cheques with an annual discount rate.
 */
export function calculateChequesDiscounting(
  items: ChequeCalculationInput[],
  annualRatePercent: number,
  baseDateInput?: Date | string,
): DiscountResult {
  if (!items || items.length === 0) {
    throw new BadRequestException('حداقل یک فقره چک برای محاسبه تنزیل الزامی است.');
  }

  const rasgiri = calculateRasgiri(items, baseDateInput);
  const baseDate = rasgiri.baseDate;

  let totalAmountMinor = 0n;
  let totalDiscountMinor = 0n;

  const discountItems: ChequeDiscountItemDetail[] = items.map((item) => {
    const amtMinor = toCalculatorMinor(item.amount);
    const dueYmd = normalizeDateToYmd(item.dueDate);
    const days = Math.max(0, diffInDays(baseDate, dueYmd));
    const single = calculateSingleDiscount(item.amount, days, annualRatePercent);

    totalAmountMinor += amtMinor;
    totalDiscountMinor += single.discountMinor;

    return {
      id: item.id,
      amount: formatMinorRial(amtMinor),
      dueDate: dueYmd,
      days,
      discountAmount: single.discountAmount,
      netPresentValue: single.netPresentValue,
      effectivePeriodRatePercent: single.effectivePeriodRatePercent,
    };
  });

  const netPresentValueMinor = totalAmountMinor - totalDiscountMinor;

  return {
    totalAmount: formatMinorRial(totalAmountMinor),
    totalDiscountAmount: formatMinorRial(totalDiscountMinor),
    netPresentValue: formatMinorRial(netPresentValueMinor),
    annualRatePercent,
    baseDate,
    weightedAverageDays: rasgiri.weightedAverageDays,
    items: discountItems,
  };
}
