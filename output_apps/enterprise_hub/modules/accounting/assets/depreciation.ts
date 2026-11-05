import { parseScaled } from '../money';

export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

/** Everything the monthly charge depends on. Amounts are exact integer minor units. */
export interface DepreciationTerms {
  costMinor: bigint;
  salvageMinor: bigint;
  accumulatedMinor: bigint;
  monthsDone: number;
  method: DepreciationMethod;
  /** Straight line: life in months. */
  lifeMonths: number | null;
  /** Declining balance: annual rate as a decimal string such as "0.25". */
  annualRate: string | null;
}

const PPM = 6;

/** Rounds half up on a non-negative numerator. */
const divRound = (numerator: bigint, denominator: bigint): bigint => (numerator * 2n + denominator) / (denominator * 2n);

/**
 * The charge for the asset's next month, never taking its book value below salvage.
 *  - Straight line: cumulative target after k months is round((cost - salvage) * k / life), so
 *    the months add up to exactly the depreciable amount and no cent is lost to rounding.
 *  - Declining balance: round(book value * annual rate / 12). Once that rounds to zero the
 *    remaining few minor units are written off in one month, so the asset still reaches
 *    FULLY_DEPRECIATED instead of charging zero forever.
 */
export function nextMonthCharge(terms: DepreciationTerms): bigint {
  const depreciable = terms.costMinor - terms.salvageMinor;
  const remaining = depreciable - terms.accumulatedMinor;
  if (remaining <= 0n) {
    return 0n;
  }
  let charge: bigint;
  if (terms.method === 'STRAIGHT_LINE') {
    if (!terms.lifeMonths || terms.lifeMonths < 1) {
      throw new Error('Straight-line depreciation needs a life in months.');
    }
    const k = BigInt(Math.min(terms.monthsDone + 1, terms.lifeMonths));
    const target = divRound(depreciable * k, BigInt(terms.lifeMonths));
    charge = target - terms.accumulatedMinor;
  } else {
    if (terms.annualRate == null) {
      throw new Error('Declining-balance depreciation needs an annual rate.');
    }
    const ppm = parseScaled(terms.annualRate, PPM);
    const bookValue = terms.costMinor - terms.accumulatedMinor;
    charge = divRound(bookValue * ppm, 12n * 10n ** BigInt(PPM));
    if (charge === 0n) {
      charge = remaining;
    }
  }
  if (charge < 0n) {
    return 0n;
  }
  return charge > remaining ? remaining : charge;
}

/** Month index used to order periods: Jalali year * 12 + (month - 1). */
export const periodIndex = (year: number, month: number): number => year * 12 + (month - 1);
