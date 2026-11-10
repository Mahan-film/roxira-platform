/**
 * Pure landed-cost rules (#227 T2, docs/accounting/PURCHASE_CYCLE.md). No I/O: the service loads
 * the receipt and its FIFO layers, these functions decide the allocation. All arithmetic is exact
 * bigint: money in minor units (rial x 100), quantities in hundredths, weights in thousandths of
 * a kg, so the allocations always sum exactly to the cost amount.
 */
import { GoodsReceiptLine } from './purchase.types';

export enum LandedCostCategory {
  FREIGHT = 'FREIGHT',
  CUSTOMS = 'CUSTOMS',
  INSURANCE = 'INSURANCE',
  OTHER = 'OTHER',
}

export enum LandedCostBasis {
  VALUE = 'VALUE',
  QUANTITY = 'QUANTITY',
  WEIGHT = 'WEIGHT',
}

export type LandedCostErrorCode = 'INVALID_AMOUNT' | 'MISSING_WEIGHT' | 'NOT_ALLOCATABLE';

export class LandedCostError extends Error {
  constructor(
    readonly code: LandedCostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LandedCostError';
  }
}

/** Largest amount the ledger can carry: numeric(18,2) minor units (`parseMinor` envelope). */
export const MAX_LANDED_COST_MINOR = 10n ** 18n - 1n;

export const LANDED_COST_CATEGORY_LABEL: Record<LandedCostCategory, string> = {
  [LandedCostCategory.FREIGHT]: 'حمل',
  [LandedCostCategory.CUSTOMS]: 'گمرک',
  [LandedCostCategory.INSURANCE]: 'بیمه',
  [LandedCostCategory.OTHER]: 'سایر',
};

/** The weight of one receipt line under the chosen basis; `null` weight on WEIGHT is a 400. */
export function basisWeight(line: GoodsReceiptLine, basis: LandedCostBasis): bigint {
  switch (basis) {
    case LandedCostBasis.VALUE:
      return line.value;
    case LandedCostBasis.QUANTITY:
      return line.quantity;
    case LandedCostBasis.WEIGHT:
      if (line.weight === null) {
        throw new LandedCostError(
          'MISSING_WEIGHT',
          `سطر رسید کالای «${line.sku}» وزن ندارد و تخصیص بر پایه وزن ممکن نیست.`,
        );
      }
      return line.weight;
  }
}

export interface LandedCostShare {
  line: GoodsReceiptLine;
  /** The basis weight the share came from (line value, quantity or weight). */
  basisValue: bigint;
  /** Allocated part of the amount, minor units. */
  share: bigint;
}

/**
 * Splits `amount` over the receipt lines by the largest-remainder method: every line gets the
 * floor of its exact proportion, the leftover minor units go one each to the lines with the
 * largest fractional parts (equal fractions in line order), so the shares sum exactly to
 * `amount`. A non-positive amount, no lines or a zero total weight are refused.
 */
export function allocateLandedCost(
  amount: bigint,
  lines: readonly GoodsReceiptLine[],
  basis: LandedCostBasis,
): LandedCostShare[] {
  if (amount <= 0n) {
    throw new LandedCostError('INVALID_AMOUNT', 'مبلغ هزینه سربار باید مثبت باشد.');
  }
  if (amount > MAX_LANDED_COST_MINOR) {
    throw new LandedCostError('INVALID_AMOUNT', 'مبلغ هزینه سربار از حد مجاز سند حسابداری بزرگ‌تر است.');
  }
  if (lines.length === 0) {
    throw new LandedCostError('NOT_ALLOCATABLE', 'این رسید سطری برای تخصیص هزینه ندارد.');
  }

  const weights = lines.map((line) => basisWeight(line, basis));
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total <= 0n) {
    throw new LandedCostError('NOT_ALLOCATABLE', 'جمع وزن تخصیص صفر است؛ هزینه قابل تقسیم نیست.');
  }

  const base = weights.map((weight) => (amount * weight) / total);
  let remainder = amount - base.reduce((sum, part) => sum + part, 0n);
  // Fractional parts scaled by the total weight; ties keep the receipt line order.
  const order = weights
    .map((weight, index) => ({ index, fraction: amount * weight - base[index] * total }))
    .sort((a, b) => (a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1));
  for (const candidate of order) {
    if (remainder <= 0n) break;
    base[candidate.index] += 1n;
    remainder -= 1n;
  }

  return lines.map((line, index) => ({ line, basisValue: weights[index], share: base[index] }));
}

export interface ShareSplit {
  /** The part still on hand in the line's FIFO layer, minor units. */
  toInventory: bigint;
  /** The part already issued from the layer, minor units. */
  toCogs: bigint;
}

/**
 * Splits one line's share between what is still in its FIFO layer and what was already issued
 * from it, in the proportion of the quantities (round half up on the on-hand part). A layer fully
 * issued sends the whole share to COGS; nothing leaves the line's share unassigned.
 */
export function splitShare(share: bigint, lineQuantity: bigint, remainingQuantity: bigint): ShareSplit {
  const remaining = remainingQuantity < 0n ? 0n : remainingQuantity > lineQuantity ? lineQuantity : remainingQuantity;
  const toInventory = (share * remaining + lineQuantity / 2n) / lineQuantity;
  return { toInventory, toCogs: share - toInventory };
}

export interface LayerRaise {
  /** Increase of the layer's unit cost, minor units per whole unit (integer). */
  raisePerUnit: bigint;
  /**
   * What the unit cost could not carry (its 2-decimal granularity). Booked to COGS so the
   * FIFO layer valuation equals the ledger inventory line exactly down to 0 rials difference.
   */
  remainder: bigint;
}

/**
 * The largest unit-cost increase that keeps the layer's value rise inside `toInventory` minor
 * units: the rise is `remaining (hundredths) x raisePerUnit / 100`.
 */
export function layerRaise(toInventory: bigint, remainingQuantity: bigint): LayerRaise {
  if (remainingQuantity <= 0n || toInventory <= 0n) {
    return { raisePerUnit: 0n, remainder: toInventory < 0n ? 0n : toInventory };
  }
  const raisePerUnit = (toInventory * 100n) / remainingQuantity;
  return { raisePerUnit, remainder: toInventory - (raisePerUnit * remainingQuantity) / 100n };
}
