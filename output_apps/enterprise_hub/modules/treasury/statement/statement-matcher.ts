import { minorToDecimal } from '../../accounting/money';

/**
 * Deterministic matching of a bank credit to open sales invoices. Pure: no I/O, no clock, no model.
 *
 * Rule 1, exact reference: every open invoice whose number appears in the line's reference text
 *   (whole-token match, digits normalised). If the amount equals their open total the match is exact
 *   and may be confirmed automatically. If the bank paid slightly less (up to 5 % of the open total)
 *   the difference is proposed as a bank fee on the same posting; a bigger shortfall is proposed as
 *   a partial payment, oldest invoice first. Both need a person's confirmation.
 * Rule 2, amount + date window: no invoice number in the text, but exactly one open invoice has
 *   the same open amount and an invoice date within `windowDays` of the booking date. Suggestion
 *   only, never automatic. Several candidates is a tie and gives no suggestion.
 */
export interface OpenInvoice {
  id: string;
  number: string;
  /** Open amount in minor units, always > 0. */
  outstanding: bigint;
  /** YYYY-MM-DD, null when the invoice has no issue date. */
  date: string | null;
}

export interface MatchableLine {
  amountMinor: bigint;
  bookingDate: string;
  reference: string;
}

export type MatchRule = 'reference' | 'amount_date';

export interface SuggestedAllocation {
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: bigint;
}

export interface MatchSuggestion {
  rule: MatchRule;
  allocations: SuggestedAllocation[];
  /** Bank fee booked on the same voucher, minor units (0 when none). */
  feeMinor: bigint;
  /** True only for an exact reference match with no fee: safe to confirm without a person. */
  auto: boolean;
  explanation: string;
}

export const DEFAULT_WINDOW_DAYS = 30;
/** A shortfall up to 1/20 of the referenced open total is proposed as a bank fee. */
export const FEE_SHORTFALL_DIVISOR = 20n;
const MIN_NUMBER_LENGTH = 3;

const DIGITS: Record<string, string> = {};
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGITS[d] = String(i)));
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGITS[d] = String(i)));

export function normaliseText(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d] ?? d).toUpperCase();
}

const isTokenChar = (c: string | undefined): boolean => c !== undefined && /[A-Z0-9]/.test(c);

/** True when `number` occurs in `text` as a whole token (INV-10 does not match inside INV-101). */
export function mentions(text: string, number: string): boolean {
  const needle = normaliseText(number).trim();
  if (needle.length < MIN_NUMBER_LENGTH) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    if (!isTokenChar(text[at - 1]) && !isTokenChar(text[at + needle.length])) return true;
    from = at + 1;
  }
}

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

const fmt = minorToDecimal;

export function suggestMatch(
  line: MatchableLine,
  open: readonly OpenInvoice[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): MatchSuggestion | null {
  if (line.amountMinor <= 0n) return null;
  const text = normaliseText(line.reference);
  const ordered = [...open]
    .filter((i) => i.outstanding > 0n)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.number.localeCompare(b.number));

  const referenced = ordered.filter((i) => mentions(text, i.number));
  if (referenced.length > 0) {
    const openTotal = referenced.reduce((s, i) => s + i.outstanding, 0n);
    const numbers = referenced.map((i) => i.number).join(', ');
    if (line.amountMinor === openTotal) {
      return {
        rule: 'reference',
        allocations: referenced.map((i) => ({ invoiceId: i.id, invoiceNumber: i.number, amountMinor: i.outstanding })),
        feeMinor: 0n,
        auto: true,
        explanation: `Reference names ${numbers}; amount ${fmt(line.amountMinor)} equals their open total.`,
      };
    }
    if (line.amountMinor < openTotal) {
      const shortfall = openTotal - line.amountMinor;
      if (shortfall * FEE_SHORTFALL_DIVISOR <= openTotal) {
        return {
          rule: 'reference',
          allocations: referenced.map((i) => ({ invoiceId: i.id, invoiceNumber: i.number, amountMinor: i.outstanding })),
          feeMinor: shortfall,
          auto: false,
          explanation:
            `Reference names ${numbers}; open total ${fmt(openTotal)}, received ${fmt(line.amountMinor)}: ` +
            `the ${fmt(shortfall)} difference is proposed as a bank fee (needs confirmation).`,
        };
      }
      let left = line.amountMinor;
      const allocations: SuggestedAllocation[] = [];
      for (const i of referenced) {
        if (left === 0n) break;
        const part = left < i.outstanding ? left : i.outstanding;
        allocations.push({ invoiceId: i.id, invoiceNumber: i.number, amountMinor: part });
        left -= part;
      }
      return {
        rule: 'reference',
        allocations,
        feeMinor: 0n,
        auto: false,
        explanation: `Reference names ${numbers}; received ${fmt(line.amountMinor)} of ${fmt(openTotal)} open: partial payment, oldest invoice first (needs confirmation).`,
      };
    }
    return null; // paid more than the named invoices: an overpayment is a person's decision
  }

  if (line.bookingDate) {
    const booked = dayNumber(line.bookingDate);
    const candidates = ordered.filter(
      (i) => i.outstanding === line.amountMinor && i.date !== null && Math.abs(dayNumber(i.date) - booked) <= windowDays,
    );
    if (candidates.length === 1) {
      const [only] = candidates;
      return {
        rule: 'amount_date',
        allocations: [{ invoiceId: only.id, invoiceNumber: only.number, amountMinor: only.outstanding }],
        feeMinor: 0n,
        auto: false,
        explanation: `No invoice number in the reference; ${only.number} is the only open invoice of ${fmt(line.amountMinor)} dated within ${windowDays} days of ${line.bookingDate} (needs confirmation).`,
      };
    }
  }
  return null;
}
