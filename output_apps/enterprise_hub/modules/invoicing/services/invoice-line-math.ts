/**
 * The ONE definition of invoice line arithmetic. `InvoicingService` (what is stored) and the
 * Moadian pre-flight validator (what is checked before submit) both call it, so they cannot drift.
 *
 *   gross    = quantity x unitPrice          (kept unrounded; never rounded per line)
 *   taxable  = max(0, gross - discount)      (VAT on the discounted base)
 *   tax      = round(taxable x vatRate)      (half up, to the currency scale)
 *   total    = round(taxable + tax)          (half up)
 *   header totalAmount = round(sum of unrounded line gross), rounded once
 *
 * Everything is bigint; no float is involved. Inputs are scaled integers:
 *   quantity  at LINE_QUANTITY_DECIMALS, unitPrice at (scale + LINE_PRICE_EXTRA_DECIMALS),
 *   discount  at `scale` (already rounded, as stored), vatRate at LINE_RATE_DECIMALS.
 * Results `tax`, `total`, `taxable` and `discount` are at `scale` (minor units of the currency).
 */
export const LINE_QUANTITY_DECIMALS = 4;
export const LINE_PRICE_EXTRA_DECIMALS = 4;
export const LINE_RATE_DECIMALS = 6;

/** Decimals of the unrounded gross: quantity decimals + price extra decimals. */
const GROSS_EXTRA_DECIMALS = LINE_QUANTITY_DECIMALS + LINE_PRICE_EXTRA_DECIMALS;
const GROSS_EXTRA = 10n ** BigInt(GROSS_EXTRA_DECIMALS);
const RATE_FACTOR = 10n ** BigInt(LINE_RATE_DECIMALS);

export interface LineMathInput {
  quantity: bigint;
  unitPrice: bigint;
  discount: bigint;
  vatRate: bigint;
}

export interface LineMathResult {
  /** quantity x unitPrice with GROSS_EXTRA_DECIMALS extra decimals (unrounded). */
  grossFine: bigint;
  /** Rounded gross, for display only; header totals must sum `grossFine`. */
  gross: bigint;
  discount: bigint;
  taxable: bigint;
  tax: bigint;
  total: bigint;
}

/** Integer division rounded half up; handles negative numerators symmetrically. */
function divRoundHalfUp(numerator: bigint, divisor: bigint): bigint {
  if (numerator < 0n) {
    return -((-numerator * 2n + divisor) / (divisor * 2n));
  }
  return (numerator * 2n + divisor) / (divisor * 2n);
}

export function computeLineMath(input: LineMathInput): LineMathResult {
  const grossFine = input.quantity * input.unitPrice;
  const discountFine = input.discount * GROSS_EXTRA;
  const taxableFine = grossFine > discountFine ? grossFine - discountFine : 0n;
  const tax = divRoundHalfUp(taxableFine * input.vatRate, GROSS_EXTRA * RATE_FACTOR);
  const total = divRoundHalfUp(taxableFine, GROSS_EXTRA) + tax;
  return {
    grossFine,
    gross: divRoundHalfUp(grossFine, GROSS_EXTRA),
    discount: input.discount,
    taxable: divRoundHalfUp(taxableFine, GROSS_EXTRA),
    tax,
    total,
  };
}

/** Header gross: the unrounded line grosses summed, then rounded once. */
export function sumGrossMinor(lines: Array<Pick<LineMathResult, 'grossFine'>>): bigint {
  return divRoundHalfUp(
    lines.reduce((sum, line) => sum + line.grossFine, 0n),
    GROSS_EXTRA,
  );
}

/**
 * Scaled integer of a JSON number or decimal string, parsed and rounded half up without float
 * multiplication. Throws RangeError on non-finite or non-decimal values.
 */
export function numberToScaled(value: number | string, decimals: number): bigint {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e21) {
      throw new RangeError(`Invalid decimal number for scaling: ${value}`);
    }
    text = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  } else {
    text = value.trim();
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new RangeError(`Invalid decimal value for scaling: "${String(value)}"`);
  }
  const [, sign, integer, fraction = ''] = match;
  let units = BigInt(integer + fraction.slice(0, decimals).padEnd(decimals, '0'));
  if (fraction.length > decimals && fraction[decimals] >= '5') {
    units += 1n;
  }
  return sign === '-' && units !== 0n ? -units : units;
}
