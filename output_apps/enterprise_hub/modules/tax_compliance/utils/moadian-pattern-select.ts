import { MoadianInvoicePattern as P } from '../enums/moadian.enum';

/**
 * Fields that belong to one pattern only (docs/legal_sources/iran/moadian-fields.md: the field is
 * mandatory or optional in that pattern and `ignore` in the others). Fields shared by several
 * patterns (cut, exr, cfee, mu, scln, scc ...) say nothing about the pattern and are not listed.
 */
const HEADER_SIGNALS: Record<string, P> = {
  ft: P.AIRLINE_TICKET, tinc: P.AIRLINE_TICKET, crn: P.CONTRACT, billid: P.UTILITY_BILLS,
  cdcn: P.EXPORT, cdcd: P.EXPORT, tonw: P.EXPORT, torv: P.EXPORT, tocv: P.EXPORT,
};
const ITEM_SIGNALS: Record<string, P> = {
  cpr: P.SALE_CURRENCY, sovat: P.SALE_CURRENCY,
  consfee: P.GOLD, spro: P.GOLD, bros: P.GOLD, tcpbs: P.GOLD, cui: P.GOLD,
  ssrv: P.EXPORT, sscv: P.EXPORT, nw: P.EXPORT,
};

const PATTERN_NAMES: Record<number, string> = {
  1: 'فروش', 2: 'فروش ارز', 3: 'طلا، جواهر و پلاتین', 4: 'قرارداد پیمانکاری', 5: 'قبوض خدماتی', 6: 'بلیط هواپیما', 7: 'صادرات',
};
export const patternName = (pattern: number): string => `${pattern} (${PATTERN_NAMES[pattern] ?? '؟'})`;

export class MoadianPatternSelectionError extends Error {}

/**
 * Pattern of an invoice from what the caller supplies: an explicit pattern wins and must agree with
 * the data; without one the pattern-only fields decide, and no such field means pattern 1 (sale).
 */
export function choosePattern(
  explicit: number | undefined,
  extras: { header?: Record<string, unknown>; items?: Array<Record<string, unknown>> } | undefined,
): P {
  const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
  const signalled = new Set<P>();
  for (const [key, pattern] of Object.entries(HEADER_SIGNALS)) {
    if (has(extras?.header?.[key])) signalled.add(pattern);
  }
  for (const item of extras?.items ?? []) {
    for (const [key, pattern] of Object.entries(ITEM_SIGNALS)) {
      if (has(item?.[key])) signalled.add(pattern);
    }
  }
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit < 1 || explicit > 7) {
      throw new MoadianPatternSelectionError('الگوی صورتحساب باید بین ۱ تا ۷ باشد؛ الگوهای دیگر هنوز پشتیبانی نمی‌شوند.');
    }
    const other = [...signalled].filter((p) => p !== explicit);
    if (other.length > 0) {
      throw new MoadianPatternSelectionError(
        `داده‌های الگوی ${patternName(other[0])} با الگوی انتخاب‌شده ${patternName(explicit)} نمی‌خواند.`,
      );
    }
    return explicit;
  }
  if (signalled.size > 1) {
    throw new MoadianPatternSelectionError(
      `داده‌های چند الگو هم‌زمان آمده است (${[...signalled].map(patternName).join('، ')})؛ الگو را مشخص کنید.`,
    );
  }
  return signalled.size === 1 ? [...signalled][0] : P.SALE;
}
