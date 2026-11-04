/**
 * Line and invoice discounts (E1.3). VAT is charged on the discounted base, so an invoice-level
 * discount is spread over the lines before tax: each line carries its share in `discount`, and
 * `tax = (gross - discount) × vatRate` stays a per-line figure (the Moadian layout has no
 * invoice-level discount field; every line reports its own).
 *
 * All arithmetic is in integer minor units (bigint) so shares never drift by a rial.
 */

/** Integer minor units of `value` at `scale` decimals (rounded half away from zero). */
export function toMinor(value: number, scale: number): bigint {
  const factor = 10 ** scale;
  const scaled = Math.round((Math.abs(value) + Number.EPSILON) * factor);
  return BigInt(value < 0 ? -scaled : scaled);
}

export function fromMinor(value: bigint, scale: number): number {
  return Number(value) / 10 ** scale;
}

/** `percent`% of `base` minor units, rounded half up. */
export function percentOf(base: bigint, percent: number): bigint {
  // percent has at most 4 decimals (DTO validation): work in 1/10000 of a percent.
  const p = BigInt(Math.round(percent * 10_000));
  return (base * p * 2n + 1_000_000n) / 2_000_000n;
}

/**
 * Split `discount` over `bases` in proportion to each base (largest remainder method), so the
 * shares add up to `discount` exactly. A zero base takes nothing. The caller has checked that
 * 0 <= discount <= sum(bases).
 */
export function allocateDiscount(bases: bigint[], discount: bigint): bigint[] {
  const total = bases.reduce((sum, base) => sum + base, 0n);
  if (discount <= 0n || total <= 0n) {
    return bases.map(() => 0n);
  }
  const shares = bases.map((base) => (base * discount) / total);
  let left = discount - shares.reduce((sum, share) => sum + share, 0n);
  const order = bases
    .map((base, index) => ({ index, remainder: (base * discount) % total }))
    .filter(({ index }) => bases[index] > 0n)
    // Largest remainder first; ties go to the earlier line so the result is deterministic.
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of order) {
    if (left <= 0n) break;
    shares[index] += 1n;
    left -= 1n;
  }
  return shares;
}
