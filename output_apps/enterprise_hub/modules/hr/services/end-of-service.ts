/**
 * End-of-service benefit (sanavat, Labour Law art. 24) and unused-leave settlement.
 * Pure functions, no I/O, whole rials, no floating point on money.
 *
 * Rules built (source: Labour Law art. 24; confirm with an accountant, see
 * docs/hr/STATUTORY_OPEN_ITEMS.md):
 *   - `daysPerYear` days of the last daily wage for each full year of service;
 *   - a part year earns the same share pro rata: remaining calendar days / `yearDays`;
 *   - unused leave is paid at the same daily wage.
 * `daysPerYear` and `yearDays` come from the statutory parameter store (sanavat_days_per_year,
 * sanavat_year_days), never from code. The caller supplies the daily wage (what counts as "last wage" is a contract matter), so no
 * statutory amount is invented here.
 */


export interface EndOfServiceInput {
  /** First day of service, ISO date (YYYY-MM-DD, Gregorian). */
  hireDate: string;
  /** Last day of service, ISO date; counted as a worked day. */
  terminationDate: string;
  /** Last daily wage in whole rials. */
  dailyWage: bigint;
  /** Days of daily wage per full year of service (statutory parameter). */
  daysPerYear: number;
  /** Day count of a year for the part-year share (statutory parameter). */
  yearDays: number;
  /** Unused leave days owed at termination (may be fractional, e.g. 2.5). */
  unusedLeaveDays?: number;
}

export interface EndOfServiceResult {
  fullYears: number;
  /** Calendar days beyond the full years (0..365). */
  extraDays: number;
  /** Sanavat in whole rials. */
  endOfServiceBenefit: bigint;
  /** Unused-leave pay in whole rials. */
  leaveSettlement: bigint;
  total: bigint;
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
  if (input.dailyWage < 0n) {
    throw new RangeError('dailyWage must be a non-negative whole number of rials');
  }
  if (!Number.isSafeInteger(input.daysPerYear) || input.daysPerYear <= 0) {
    throw new RangeError('daysPerYear must be a positive whole number');
  }
  if (!Number.isSafeInteger(input.yearDays) || input.yearDays <= 0) {
    throw new RangeError('yearDays must be a positive whole number');
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

  const wage = input.dailyWage;
  const perYear = wage * BigInt(input.daysPerYear);
  const benefit =
    perYear * BigInt(fullYears) +
    divideHalfUp(perYear * BigInt(extraDays), BigInt(input.yearDays));
  // Leave days are held in hundredths so 2.5 days is exact.
  const leave = divideHalfUp(wage * BigInt(Math.round(leaveDays * 100)), 100n);

  return {
    fullYears,
    extraDays,
    endOfServiceBenefit: benefit,
    leaveSettlement: leave,
    total: benefit + leave,
  };
}
