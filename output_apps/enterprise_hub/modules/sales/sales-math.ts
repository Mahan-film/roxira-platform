import { MoneyFormatError, parseScaled } from '../accounting/money';

/** Quantity scale: hundredths, matching numeric(12,2) columns and the inventory quantity unit. */
export const QUANTITY_SCALE = 2;

const HUNDRED = 100n;

/** Raised for a quantity or line that cannot be represented exactly; the service maps it to 400. */
export class SalesMathError extends Error {}

/**
 * Hundredths of a quantity received as a JSON number or decimal string. Uses `parseScaled(v, 2)`,
 * so more than two decimals throws (it never rounds, issue #500); a value at or below zero also
 * throws. Never uses floating point.
 */
export function parseQuantityHundredths(value: number | string): bigint {
  let scaled: bigint;
  try {
    scaled = parseScaled(value, QUANTITY_SCALE);
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      throw new SalesMathError(error.message);
    }
    throw error;
  }
  if (scaled <= 0n) {
    throw new SalesMathError('Quantity must be greater than zero.');
  }
  return scaled;
}

/** Round-half-up integer division for non-negative operands. */
function halfUpDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/**
 * Exact line total in minor units: round-half-up of `qtyHundredths * unitPriceMinor / 100`, minus
 * the line discount. Throws when the discount exceeds the gross amount or the result would be
 * negative. No VAT here: the invoice posts the statutory VAT.
 */
export function computeLine(qtyHundredths: bigint, unitPriceMinor: bigint, discountMinor: bigint): bigint {
  if (qtyHundredths <= 0n) throw new SalesMathError('Quantity must be greater than zero.');
  if (unitPriceMinor < 0n) throw new SalesMathError('Unit price cannot be negative.');
  if (discountMinor < 0n) throw new SalesMathError('Discount cannot be negative.');
  const gross = halfUpDivide(qtyHundredths * unitPriceMinor, HUNDRED);
  if (discountMinor > gross) {
    throw new SalesMathError('Discount cannot exceed the line gross amount.');
  }
  const net = gross - discountMinor;
  if (net < 0n) throw new SalesMathError('Line total cannot be negative.');
  return net;
}

/** Sum of line totals in minor units. */
export function sumLineTotals(totals: readonly bigint[]): bigint {
  return totals.reduce<bigint>((sum, value) => sum + value, 0n);
}

/**
 * Hundredths of a quantity read from a DB `double precision` column (`erp_stock_items.quantity`).
 * Tolerant on purpose: same rounding as `InventoryService.roundQuantity`, so float noise
 * (0.30000000000000004), negatives and values with more than two decimals never throw; a
 * non-finite value counts as 0. Use `parseScaled` only for numeric text.
 */
export function doubleToHundredths(value: unknown): bigint {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round((n + Number.EPSILON) * 100));
}
