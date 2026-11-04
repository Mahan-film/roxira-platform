import { BadRequestException } from '@nestjs/common';
import { isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { isValidStatutoryValue, StatutoryKey } from '../../hr/statutory/statutory-catalogue';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';

export interface Bracket {
  /** Upper bound of the band in rials, `null` for the last band. */
  upTo: number | null;
  /** Decimal string in [0, 1]. */
  rate: string;
}

export interface StatutoryUse {
  key: StatutoryKey;
  value: unknown;
  effectiveFrom: string;
  version: number;
  source: string;
  verified: boolean;
}

const SCALE = 1_000_000n;

/** amount (minor units) x rate (decimal string, <= 6 places), rounded half up. */
export function applyRate(amountMinor: bigint, rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  return (amountMinor * BigInt(whole + fraction.padEnd(6, '0')) + SCALE / 2n) / SCALE;
}

/** Tax of `incomeMinor` on a progressive schedule: each band's slice at its own rate, rounded per band. */
export function bracketTax(incomeMinor: bigint, brackets: Bracket[]): bigint {
  let tax = 0n;
  let lower = 0n;
  for (const band of brackets) {
    const upper = band.upTo === null ? null : BigInt(band.upTo) * 100n; // rials to minor units
    if (incomeMinor <= lower) break;
    const slice = (upper === null || incomeMinor < upper ? incomeMinor : upper) - lower;
    tax += applyRate(slice, band.rate);
    if (upper === null) break;
    lower = upper;
  }
  return tax;
}

/** Statutory values in force at the end of the Jalali fiscal year; missing or malformed ones refuse the preview. */
export async function readStatutory(
  repository: StatutoryRepository,
  tenantId: string,
  fiscalYear: number,
  keys: readonly StatutoryKey[],
): Promise<Map<StatutoryKey, StatutoryUse>> {
  const rows = await repository.findForYear(tenantId, IRAN, fiscalYear);
  const resolved = resolveParameters(rows, isoDate(jalaliMonthEnd(fiscalYear, 12)));
  const out = new Map<StatutoryKey, StatutoryUse>();
  for (const key of keys) {
    const row = resolved.get(key);
    if (!row || !isValidStatutoryValue(key, row.value)) {
      throw new BadRequestException(
        `پارامتر قانونی «${key}» برای سال ${fiscalYear} تعریف نشده یا نامعتبر است؛ منبع قانونی تأییدشده لازم است.`,
      );
    }
    out.set(key, {
      key,
      value: row.value,
      effectiveFrom: row.effectiveFrom.slice(0, 10),
      version: row.version,
      source: row.source,
      verified: row.verified,
    });
  }
  return out;
}
