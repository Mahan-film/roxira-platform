/**
 * Cheque Ras-giri (راس‌گیری چک) and Discounting (تنزیل چک) Calculator Utility.
 * Uses BigInt for minor currency units (Rials) to avoid IEEE 754 precision loss.
 */

export interface ChequeCalculationInput {
  id?: string | number;
  amount: bigint | number | string;
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

/** Converts Date or string to UTC YYYY-MM-DD */
export function normalizeDateToYmd(dateInput: Date | string): string {
  if (typeof dateInput === 'string') {
    // If format like 2026-11-10T... or 2026-11-10
    const m = dateInput.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(m)) {
      return m;
    }
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    throw new Error(`تاریخ نامعتبر است: ${dateInput}`);
  }
  return d.toISOString().slice(0, 10);
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

/** Parses amount to BigInt minor units */
export function toBigIntAmount(amount: bigint | number | string): bigint {
  if (typeof amount === 'bigint') return amount;
  const str = String(amount).trim().replace(/,/g, '');
  if (!/^-?\d+$/.test(str)) {
    // If it has decimals, parse integer part or round
    const num = Math.round(Number(str));
    if (isNaN(num)) throw new Error(`مبلغ نامعتبر است: ${amount}`);
    return BigInt(num);
  }
  return BigInt(str);
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
    throw new Error('حداقل یک فقره چک برای محاسبه راس‌گیری الزامی است.');
  }

  const baseDate = baseDateInput
    ? normalizeDateToYmd(baseDateInput)
    : new Date().toISOString().slice(0, 10);

  let totalAmount = 0n;
  const processedItems = items.map((item) => {
    const amt = toBigIntAmount(item.amount);
    if (amt <= 0n) {
      throw new Error(`مبلغ چک باید مثبت و بزرگ‌تر از صفر باشد: ${item.amount}`);
    }
    const dueYmd = normalizeDateToYmd(item.dueDate);
    const days = diffInDays(baseDate, dueYmd);
    totalAmount += amt;
    return {
      item,
      amt,
      dueYmd,
      days,
    };
  });

  if (totalAmount <= 0n) {
    throw new Error('مجموع مبالغ چک‌ها باید بزرگ‌تر از صفر باشد.');
  }

  // Calculate weighted days: sum(amt * days) / totalAmount
  let weightedProductSum = 0n;
  for (const pi of processedItems) {
    weightedProductSum += pi.amt * BigInt(pi.days);
  }

  // Integer division with half-up rounding
  const quotient = weightedProductSum / totalAmount;
  const remainder = weightedProductSum % totalAmount;
  let avgDays = Number(quotient);
  if (weightedProductSum >= 0n) {
    if (remainder * 2n >= totalAmount) {
      avgDays += 1;
    }
  } else {
    if (remainder * 2n <= -totalAmount) {
      avgDays -= 1;
    }
  }

  const weightedMaturityDate = addDaysToYmd(baseDate, avgDays);

  const itemDetails: ChequeCalculationItemDetail[] = processedItems.map((pi) => {
    const weightBasis = Number((pi.amt * 10000n) / totalAmount);
    return {
      id: pi.item.id,
      amount: pi.amt.toString(),
      dueDate: pi.dueYmd,
      dueDateJalali: formatToJalali(pi.dueYmd),
      days: pi.days,
      weightPercent: weightBasis / 100,
      sayadNumber: pi.item.sayadNumber,
      description: pi.item.description,
    };
  });

  return {
    totalAmount: totalAmount.toString(),
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
 * Formula:
 * Discount Amount = round((Amount * RatePercent * Days) / (365 * 100))
 * Net Present Value = Amount - Discount Amount
 */
export function calculateSingleDiscount(
  amountInput: bigint | number | string,
  days: number,
  annualRatePercent: number,
): { discountAmount: bigint; netPresentValue: bigint; effectivePeriodRatePercent: number } {
  const amt = toBigIntAmount(amountInput);
  if (amt <= 0n) {
    throw new Error('مبلغ چک برای محاسبه تنزیل باید بزرگ‌تر از صفر باشد.');
  }
  if (annualRatePercent < 0) {
    throw new Error('نرخ تنزیل سالانه نمی‌تواند منفی باشد.');
  }

  // If days <= 0 (cheque already matured or past due), discount is 0
  const effectiveDays = Math.max(0, days);
  if (effectiveDays === 0 || annualRatePercent === 0) {
    return {
      discountAmount: 0n,
      netPresentValue: amt,
      effectivePeriodRatePercent: 0,
    };
  }

  // To preserve precision with integer arithmetic:
  // Rate has up to 4 decimal places (multiply by 10,000)
  const rateScaled = BigInt(Math.round(annualRatePercent * 10000));
  const numerator = amt * rateScaled * BigInt(effectiveDays);
  const denominator = 365n * 1000000n; // 365 * 100 * 10,000

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  let discount = quotient;
  if (remainder * 2n >= denominator) {
    discount += 1n;
  }

  // Discount cannot exceed face value
  if (discount > amt) {
    discount = amt;
  }

  const npv = amt - discount;
  const effectivePeriodRatePercent =
    Math.round((Number(discount) / Number(amt)) * 10000) / 100;

  return {
    discountAmount: discount,
    netPresentValue: npv,
    effectivePeriodRatePercent,
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
    throw new Error('حداقل یک فقره چک برای محاسبه تنزیل الزامی است.');
  }

  const rasgiri = calculateRasgiri(items, baseDateInput);
  const baseDate = rasgiri.baseDate;

  let totalAmount = 0n;
  let totalDiscount = 0n;

  const discountItems: ChequeDiscountItemDetail[] = items.map((item) => {
    const amt = toBigIntAmount(item.amount);
    const dueYmd = normalizeDateToYmd(item.dueDate);
    const days = Math.max(0, diffInDays(baseDate, dueYmd));
    const { discountAmount, netPresentValue, effectivePeriodRatePercent } =
      calculateSingleDiscount(amt, days, annualRatePercent);

    totalAmount += amt;
    totalDiscount += discountAmount;

    return {
      id: item.id,
      amount: amt.toString(),
      dueDate: dueYmd,
      days,
      discountAmount: discountAmount.toString(),
      netPresentValue: netPresentValue.toString(),
      effectivePeriodRatePercent,
    };
  });

  const netPresentValue = totalAmount - totalDiscount;

  return {
    totalAmount: totalAmount.toString(),
    totalDiscountAmount: totalDiscount.toString(),
    netPresentValue: netPresentValue.toString(),
    annualRatePercent,
    baseDate,
    weightedAverageDays: rasgiri.weightedAverageDays,
    items: discountItems,
  };
}
