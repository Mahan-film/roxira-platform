/**
 * Exact integer maths for delivery notes (#536 T1). Costs live in minor units (rial x 100,
 * `money.ts`), quantities in hundredths (numeric(12,2)); no float ever touches a compared or
 * stored amount. Numbers exposed to JSON use `hundredthsToNumber`, which is exact for every
 * two-decimal quantity.
 */

/** Document-number prefix of a delivery note. */
export const DELIVERY_NUMBER_PREFIX = 'DN';

/** The source key every COGS voucher of a delivery is posted (and replayed) under. */
export const COGS_SOURCE_TYPE = 'sales_delivery';

/** The existing engine template a delivery posts its COGS with (amount `cost`). */
export const COGS_DOC_TYPE = 'invoice.sale_cogs';

/** Voucher-number prefix of a delivery COGS entry. */
export const COGS_ENTRY_PREFIX = 'DNC';

/** JSON number of a hundredths bigint; exact for every 2-decimal quantity. */
export function hundredthsToNumber(hundredths: bigint): number {
  return Number(hundredths) / 100;
}

/**
 * Unit cost in minor units: round-half-up of `lineCost * 100 / quantityHundredths`, exact when
 * the quantity divides the cost (otherwise the nearest hundredth, never a float).
 */
export function unitCostMinor(lineCostMinor: bigint, quantityHundredths: bigint): bigint {
  if (quantityHundredths <= 0n) {
    throw new Error('unitCostMinor needs a positive quantity.');
  }
  const scaled = lineCostMinor * 100n;
  return (scaled + quantityHundredths / 2n) / quantityHundredths;
}

export type FulfilmentStatus = 'NONE' | 'PARTIAL' | 'COMPLETE';

/** Status of one order line: nothing delivered yet, fully delivered, or partly. */
export function fulfilmentStatus(deliveredHundredths: bigint, orderedHundredths: bigint): FulfilmentStatus {
  if (deliveredHundredths === 0n) return 'NONE';
  return deliveredHundredths >= orderedHundredths ? 'COMPLETE' : 'PARTIAL';
}

/** Order-level status: NONE when every line is untouched, COMPLETE when no backorder remains. */
export function overallFulfilmentStatus(statuses: readonly FulfilmentStatus[]): FulfilmentStatus {
  if (statuses.length === 0 || statuses.every((status) => status === 'NONE')) return 'NONE';
  if (statuses.every((status) => status === 'COMPLETE')) return 'COMPLETE';
  return 'PARTIAL';
}
