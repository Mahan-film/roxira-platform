/**
 * Client-side Cheque Ras-giri (راس‌گیری) & Discounting (تنزیل) Calculator.
 * BigInt-safe Rial calculations with zero IEEE 754 precision loss.
 */

export interface ClientChequeItem {
  id?: string | number;
  amount: bigint | number | string;
  dueDate: string;
  sayadNumber?: string;
  description?: string;
}

export interface ClientChequeDetail {
  id?: string | number;
  amount: bigint;
  amountFormatted: string;
  dueDate: string;
  dueDateJalali: string;
  days: number;
  weightPercent: number;
  discountAmount: bigint;
  discountFormatted: string;
  netPresentValue: bigint;
  netPresentValueFormatted: string;
  effectivePeriodRatePercent: number;
  sayadNumber?: string;
  description?: string;
}

export interface ClientRasgiriDiscountResult {
  totalAmount: bigint;
  totalAmountFormatted: string;
  totalCount: number;
  baseDate: string;
  baseDateJalali: string;
  weightedAverageDays: number;
  weightedMaturityDate: string;
  weightedMaturityJalali: string;
  annualRatePercent: number;
  totalDiscountAmount: bigint;
  totalDiscountFormatted: string;
  netPresentValue: bigint;
  netPresentValueFormatted: string;
  items: ClientChequeDetail[];
}

export function parseBigIntSafe(val: bigint | number | string): bigint {
  if (typeof val === "bigint") return val;
  const cleaned = String(val).replace(/[,_\s]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return 0n;
  const num = Math.round(Number(cleaned));
  return BigInt(num);
}

export function formatRials(val: bigint): string {
  return val.toLocaleString("fa-IR") + " ریال";
}

export function formatTomans(val: bigint): string {
  const toman = val / 10n;
  return toman.toLocaleString("fa-IR") + " تومان";
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
    const parts = ymd.slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
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

/**
 * Calculates Ras-giri and Discounting for a set of cheques.
 */
export function calculateClientRasgiriAndDiscount(
  items: ClientChequeItem[],
  annualRatePercent: number = 0,
  baseDateInput?: string,
): ClientRasgiriDiscountResult {
  const baseDate = baseDateInput
    ? baseDateInput.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let totalAmount = 0n;
  let weightedProductSum = 0n;

  const validItems = items
    .map((item) => ({
      item,
      amt: parseBigIntSafe(item.amount),
      dueDate: item.dueDate.slice(0, 10),
      days: diffDays(baseDate, item.dueDate.slice(0, 10)),
    }))
    .filter((i) => i.amt > 0n);

  for (const vi of validItems) {
    totalAmount += vi.amt;
    weightedProductSum += vi.amt * BigInt(vi.days);
  }

  let avgDays = 0;
  if (totalAmount > 0n) {
    const quotient = weightedProductSum / totalAmount;
    const remainder = weightedProductSum % totalAmount;
    avgDays = Number(quotient);
    if (weightedProductSum >= 0n) {
      if (remainder * 2n >= totalAmount) avgDays += 1;
    } else {
      if (remainder * 2n <= -totalAmount) avgDays -= 1;
    }
  }

  const weightedMaturityDate = addDaysYmd(baseDate, avgDays);

  let totalDiscount = 0n;
  const processedItems: ClientChequeDetail[] = validItems.map((vi) => {
    const effectiveDays = Math.max(0, vi.days);
    let discount = 0n;
    let periodRatePercent = 0;

    if (effectiveDays > 0 && annualRatePercent > 0) {
      const rateScaled = BigInt(Math.round(annualRatePercent * 10000));
      const num = vi.amt * rateScaled * BigInt(effectiveDays);
      const den = 365n * 1000000n;
      const q = num / den;
      const r = num % den;
      discount = q;
      if (r * 2n >= den) discount += 1n;
      if (discount > vi.amt) discount = vi.amt;
      periodRatePercent = Math.round((Number(discount) / Number(vi.amt)) * 10000) / 100;
    }

    totalDiscount += discount;
    const npv = vi.amt - discount;
    const weightBasis = totalAmount > 0n ? Number((vi.amt * 10000n) / totalAmount) : 0;

    return {
      id: vi.item.id,
      amount: vi.amt,
      amountFormatted: vi.amt.toLocaleString("fa-IR"),
      dueDate: vi.dueDate,
      dueDateJalali: formatJalaliFromYmd(vi.dueDate),
      days: vi.days,
      weightPercent: weightBasis / 100,
      discountAmount: discount,
      discountFormatted: discount.toLocaleString("fa-IR"),
      netPresentValue: npv,
      netPresentValueFormatted: npv.toLocaleString("fa-IR"),
      effectivePeriodRatePercent: periodRatePercent,
      sayadNumber: vi.item.sayadNumber,
      description: vi.item.description,
    };
  });

  const netPresentValue = totalAmount - totalDiscount;

  return {
    totalAmount,
    totalAmountFormatted: totalAmount.toLocaleString("fa-IR"),
    totalCount: validItems.length,
    baseDate,
    baseDateJalali: formatJalaliFromYmd(baseDate),
    weightedAverageDays: avgDays,
    weightedMaturityDate,
    weightedMaturityJalali: formatJalaliFromYmd(weightedMaturityDate),
    annualRatePercent,
    totalDiscountAmount: totalDiscount,
    totalDiscountFormatted: totalDiscount.toLocaleString("fa-IR"),
    netPresentValue,
    netPresentValueFormatted: netPresentValue.toLocaleString("fa-IR"),
    items: processedItems,
  };
}
