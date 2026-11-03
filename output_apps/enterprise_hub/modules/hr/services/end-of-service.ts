/**
 * End-of-service benefit (sanavat, Labour Law art. 24) and unused-leave settlement.
 * Pure functions, no I/O, whole rials, no floating point on money.
 *
 * Rules built (source: Labour Law art. 24; confirm with an accountant, see
 * docs/hr/STATUTORY_OPEN_ITEMS.md):
 *   - one month (30 days) of the last daily wage for each full year of service;
 *   - a part year earns the same share pro rata: remaining calendar days / 365;
 *   - unused leave is paid at the same daily wage.
 * The caller supplies the daily wage (what counts as "last wage" is a contract matter), so no
 * statutory amount is invented here.
 */

/** Days of daily wage per full year of service. */
export const SANAVAT_DAYS_PER_YEAR = 30;
/** Divisor for the part-year share. */
export const SANAVAT_YEAR_DAYS = 365;

export interface EndOfServiceInput {
  /** First day of service, ISO date (YYYY-MM-DD, Gregorian). */
  hireDate: string;
  /** Last day of service, ISO date; counted as a worked day. */
  terminationDate: string;
  /** Last daily wage in whole rials. */
  dailyWage: number;
  /** Unused leave days owed at termination (may be fractional, e.g. 2.5). */
  unusedLeaveDays?: number;
}

export interface EndOfServiceResult {
  fullYears: number;
  /** Calendar days beyond the full years (0..365). */
  extraDays: number;
  /** Sanavat in whole rials. */
  endOfServiceBenefit: number;
  /** Unused-leave pay in whole rials. */
  leaveSettlement: number;
  total: number;
}

const parseDay = (value: string, label: string): Date => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`${label} is not a valid ISO date`);
  }
  return date;
};

const DAY_MS = 86_400_000;

/** a / b rounded half up for non-negative a and positive b. */
const divideHalfUp = (a: bigint, b: bigint): bigint => (2n * a + b) / (2n * b);

export function calculateEndOfService(input: EndOfServiceInput): EndOfServiceResult {
  const hire = parseDay(input.hireDate, 'hireDate');
  const end = parseDay(input.terminationDate, 'terminationDate');
  if (end < hire) {
    throw new RangeError('terminationDate is before hireDate');
  }
  if (!Number.isInteger(input.dailyWage) || input.dailyWage < 0) {
    throw new RangeError('dailyWage must be a non-negative whole number of rials');
  }
  const leaveDays = input.unusedLeaveDays ?? 0;
  if (!Number.isFinite(leaveDays) || leaveDays < 0) {
    throw new RangeError('unusedLeaveDays must be zero or more');
  }

  // Service runs from the hire day through the termination day, both inclusive.
  const exclusiveEnd = new Date(end.getTime() + DAY_MS);
  let fullYears = exclusiveEnd.getUTCFullYear() - hire.getUTCFullYear();
  let anniversary = new Date(hire);
  anniversary.setUTCFullYear(hire.getUTCFullYear() + fullYears);
  if (anniversary > exclusiveEnd) {
    fullYears -= 1;
    anniversary = new Date(hire);
    anniversary.setUTCFullYear(hire.getUTCFullYear() + fullYears);
  }
  const extraDays = Math.round((exclusiveEnd.getTime() - anniversary.getTime()) / DAY_MS);

  const wage = BigInt(input.dailyWage);
  const perYear = wage * BigInt(SANAVAT_DAYS_PER_YEAR);
  const benefit =
    perYear * BigInt(fullYears) +
    divideHalfUp(perYear * BigInt(extraDays), BigInt(SANAVAT_YEAR_DAYS));
  // Leave days are held in hundredths so 2.5 days is exact.
  const leave = divideHalfUp(wage * BigInt(Math.round(leaveDays * 100)), 100n);

  return {
    fullYears,
    extraDays,
    endOfServiceBenefit: Number(benefit),
    leaveSettlement: Number(leave),
    total: Number(benefit + leave),
  };
}
