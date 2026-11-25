import gulfPacksData from './data/gulf-packs.v1.json';
import { ISO_4217_CURRENCY_EXPONENTS } from '../currency-exponents';

export type GulfJurisdiction = 'SA' | 'AE' | 'OM' | 'BH' | 'QA' | 'KW';

export interface GulfEffectiveRule {
  code: string;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceUrl: string;
  asOf: string;
  verified: boolean;
  rate?: string;
  value?: number;
  amount?: number;
  years?: number;
  unit?: string;
}

export interface GulfPackConfig {
  code: GulfJurisdiction;
  currency: string;
  currencyDecimals: number;
  weekendDays: number[];
  holidays: string[];
  eInvoiceIssuanceBusinessDays: number | null;
  vatRates: GulfEffectiveRule[];
  thresholds: GulfEffectiveRule[];
  retention: GulfEffectiveRule[];
  penalties: GulfEffectiveRule[];
}

const JURISDICTIONS = gulfPacksData.jurisdictions as Record<GulfJurisdiction, GulfPackConfig>;

export function getGulfPackConfig(jurisdiction: GulfJurisdiction): GulfPackConfig {
  const cfg = JURISDICTIONS[jurisdiction];
  if (!cfg) {
    throw new Error(`Unknown Gulf jurisdiction: ${jurisdiction}`);
  }
  return cfg;
}

/**
 * Add `businessDays` working days to an ISO date (`YYYY-MM-DD`) using only the
 * jurisdiction's configured `weekendDays` (0=Sun..6=Sat) and `holidays`.
 */
export function addGulfBusinessDays(
  jurisdiction: GulfJurisdiction,
  startDateIso: string,
  businessDays: number,
): string {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error(`businessDays must be a non-negative integer, got ${businessDays}`);
  }
  const cfg = getGulfPackConfig(jurisdiction);
  const weekends = new Set(cfg.weekendDays);
  const holidays = new Set(cfg.holidays);

  const [y, m, d] = startDateIso.split('-').map((part) => parseInt(part, 10));
  const cursor = new Date(Date.UTC(y, m - 1, d));
  let remaining = businessDays;

  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    if (!weekends.has(dow) && !holidays.has(iso)) {
      remaining -= 1;
    }
  }
  return cursor.toISOString().slice(0, 10);
}

/**
 * Round a decimal string (e.g. `"12.3456"`) half-up to the jurisdiction's configured
 * currency minor-unit precision (2 or 3 decimals) using pure integer/BigInt arithmetic.
 */
export function roundGulfMajorAmount(
  jurisdiction: GulfJurisdiction,
  decimalAmount: string,
): { minorUnits: bigint; formatted: string; decimals: number } {
  const cfg = getGulfPackConfig(jurisdiction);
  const isoDecimals = ISO_4217_CURRENCY_EXPONENTS[cfg.currency];
  const decimals = cfg.currencyDecimals;
  if (isoDecimals !== undefined && isoDecimals !== decimals) {
    throw new Error(
      `Currency decimals mismatch for ${cfg.currency}: config=${decimals}, iso=${isoDecimals}`,
    );
  }

  const trimmed = decimalAmount.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid decimal amount: ${decimalAmount}`);
  }
  const negative = match[1] === '-';
  const intPart = match[2];
  const fracPart = match[3] ?? '';

  const padded = fracPart.padEnd(decimals + 1, '0');
  const kept = padded.slice(0, decimals);
  const nextDigit = parseInt(padded[decimals] ?? '0', 10);

  let minor = BigInt(intPart + kept);
  if (nextDigit >= 5) {
    minor += 1n;
  }
  if (negative && minor > 0n) {
    minor = -minor;
  }

  const absStr = (minor < 0n ? -minor : minor).toString().padStart(decimals + 1, '0');
  const whole = absStr.slice(0, absStr.length - decimals);
  const frac = decimals > 0 ? `.${absStr.slice(absStr.length - decimals)}` : '';
  const sign = minor < 0n ? '-' : '';

  return {
    minorUnits: minor,
    formatted: `${sign}${whole}${frac}`,
    decimals,
  };
}

export function resolveGulfEffectiveRule(
  jurisdiction: GulfJurisdiction,
  category: 'vatRates' | 'thresholds' | 'retention' | 'penalties',
  code: string,
  asOfDate: string,
): GulfEffectiveRule | null {
  const cfg = getGulfPackConfig(jurisdiction);
  const candidates = cfg[category].filter(
    (r) =>
      r.code === code &&
      r.effectiveFrom <= asOfDate &&
      (!r.effectiveTo || asOfDate <= r.effectiveTo),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0];
}
