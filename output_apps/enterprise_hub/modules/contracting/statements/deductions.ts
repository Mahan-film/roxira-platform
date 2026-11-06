import { parseScaled } from '../../accounting/money';
import type { ContractTerm, ContractTerms } from '../../hr/statutory/contract-terms';
import { STATUTORY_KEYS } from '../../hr/statutory/statutory-catalogue';

/** Rates are decimal strings from the statutory store; all arithmetic is bigint at 6 decimals. */
export const RATE_SCALE = 6;
const ONE = 10n ** BigInt(RATE_SCALE);

/** A needed term has no usable figure (`unclear` / `rate: null`). It is never read as zero. */
export class UnclearTermError extends Error {
  constructor(readonly termKey: string, readonly label: string) {
    super(`پارامتر قانونی «${label}» برای این تاریخ نامشخص است؛ مقدار سازمان را از بخش پارامترهای قانونی (PUT /enterprise-hub/hr/statutory-parameters) ثبت کنید.`);
  }
}

/** Scaled rate of a term; throws UnclearTermError when the store has no figure. */
export function requireRate(term: ContractTerm): bigint {
  if (term.unclear || term.rate === null) {
    throw new UnclearTermError(term.key, STATUTORY_KEYS[term.key].label);
  }
  return parseScaled(term.rate, RATE_SCALE);
}

/** amount x rate, rounded half up to a minor unit. */
export function percentOf(amount: bigint, rate: bigint): bigint {
  return (amount * rate + ONE / 2n) / ONE;
}

/** Insurance deduction: amount x base rate x (1 + unemployment addon), rounded half up once. */
export function insuranceOf(amount: bigint, baseRate: bigint, addon: bigint): bigint {
  return (amount * baseRate * (ONE + addon) + (ONE * ONE) / 2n) / (ONE * ONE);
}

/**
 * Advance recovery of one statement, in proportion to cumulative work: the total recovered up to
 * this statement is round(advance x cumulative / contract amount), minus what earlier statements
 * recovered, never below 0, never above this period or the advance still outstanding. At full
 * cumulative the whole advance is recovered, to the minor unit.
 */
export function advanceRecovery(advance: bigint, contractAmount: bigint, cumulative: bigint, alreadyRecovered: bigint, period: bigint): bigint {
  if (advance <= 0n) return 0n;
  const target = (advance * cumulative + contractAmount / 2n) / contractAmount;
  let recovery = target - alreadyRecovered;
  if (recovery < 0n) recovery = 0n;
  const outstanding = advance - alreadyRecovered;
  if (recovery > outstanding) recovery = outstanding;
  return recovery > period ? period : recovery;
}

/** What the statement stored about each figure it used, so the page can show where it came from. */
export interface TermUse {
  key: string;
  label: string;
  rate: string;
  version: number;
  source: string;
  verified: boolean;
  /** The organisation's own figure (tenant override): never presented as verified legal fact. */
  tenantOverride: boolean;
  /** True only for a platform figure that was verified. */
  legalFact: boolean;
}

export function termUse(term: ContractTerm): TermUse {
  return {
    key: term.key,
    label: STATUTORY_KEYS[term.key].label,
    rate: term.rate as string,
    version: term.version,
    source: term.source,
    verified: term.verified,
    tenantOverride: term.tenantOverride,
    legalFact: term.verified && !term.tenantOverride,
  };
}

export interface DeductionInput {
  period: bigint;
  cumulative: bigint;
  contractAmount: bigint;
  /** Contract insurance kind; null = the contract carries no insurance deduction. */
  insuranceType: keyof ContractTerms['insuranceByType'] | null;
  advancePosted: bigint;
  advanceRecovered: bigint;
  terms: ContractTerms;
}

export interface Deductions {
  retention: bigint;
  insurance: bigint;
  advance: bigint;
  used: TermUse[];
}

/** All deductions of one statement from the store's figures. Throws UnclearTermError before returning anything partial. */
export function computeDeductions(i: DeductionInput): Deductions {
  const used: TermUse[] = [];
  const retention = percentOf(i.period, requireRate(i.terms.retention));
  used.push(termUse(i.terms.retention));
  let insurance = 0n;
  if (i.insuranceType) {
    const base = i.terms.insuranceByType[i.insuranceType];
    insurance = insuranceOf(i.period, requireRate(base), requireRate(i.terms.unemploymentAddon));
    used.push(termUse(base), termUse(i.terms.unemploymentAddon));
  }
  const advance = advanceRecovery(i.advancePosted, i.contractAmount, i.cumulative, i.advanceRecovered, i.period);
  return { retention, insurance, advance, used };
}
