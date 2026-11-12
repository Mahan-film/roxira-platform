/* Reference cheque lifecycle table used by cheques.posting-rules.spec.ts against DEFAULT_ROLE_ACCOUNTS. */
import { DEFAULT_ROLE_ACCOUNTS } from '../../posting_rules/constants/posting-roles';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';

/** Amounts are integer minor units (bigint), never floats; see accounting/money.ts. */
export interface PostingLine {
  accountCode: string;
  debit: bigint;
  credit: bigint;
}

type Rule = {
  /** Journal lines for the move; null = status change only, no ledger effect. */
  lines: ((amount: bigint) => PostingLine[]) | null;
  description: string;
};

const dr = (accountCode: string, amount: bigint): PostingLine => ({ accountCode, debit: amount, credit: 0n });
const cr = (accountCode: string, amount: bigint): PostingLine => ({ accountCode, debit: 0n, credit: amount });
const A = {
  BANK: DEFAULT_ROLE_ACCOUNTS.bank!,
  RECEIVABLES: DEFAULT_ROLE_ACCOUNTS.receivable!,
  PAYABLES: DEFAULT_ROLE_ACCOUNTS.payable!,
  NOTES_RECEIVABLE_IN_HAND: DEFAULT_ROLE_ACCOUNTS.cheques_receivable!,
  NOTES_RECEIVABLE_IN_COLLECTION: DEFAULT_ROLE_ACCOUNTS.cheques_in_collection!,
  NOTES_PAYABLE: DEFAULT_ROLE_ACCOUNTS.cheques_payable!,
};

const S = ChequeStatus;

/**
 * Transition table: direction -> from -> to -> rule using `DEFAULT_ROLE_ACCOUNTS`.
 */
const TABLE: Record<ChequeDirection, Partial<Record<ChequeStatus, Partial<Record<ChequeStatus, Rule>>>>> = {
  [ChequeDirection.RECEIVED]: {
    [S.REGISTERED]: {
      [S.DEPOSITED]: { description: 'واگذاری چک به بانک برای وصول', lines: (a) => [dr(A.NOTES_RECEIVABLE_IN_COLLECTION, a), cr(A.NOTES_RECEIVABLE_IN_HAND, a)] },
      [S.CLEARED]: { description: 'وصول چک (ارائه مستقیم در بانک)', lines: (a) => [dr(A.BANK, a), cr(A.NOTES_RECEIVABLE_IN_HAND, a)] },
      [S.BOUNCED]: { description: 'برگشت چک (ارائه مستقیم در بانک)', lines: (a) => [dr(A.RECEIVABLES, a), cr(A.NOTES_RECEIVABLE_IN_HAND, a)] },
      [S.SPENT]: { description: 'خرج چک به شخص ثالث', lines: (a) => [dr(A.PAYABLES, a), cr(A.NOTES_RECEIVABLE_IN_HAND, a)] },
      [S.RETURNED]: { description: 'استرداد چک به صادرکننده', lines: (a) => [dr(A.RECEIVABLES, a), cr(A.NOTES_RECEIVABLE_IN_HAND, a)] },
    },
    [S.DEPOSITED]: {
      [S.CLEARED]: { description: 'وصول چک', lines: (a) => [dr(A.BANK, a), cr(A.NOTES_RECEIVABLE_IN_COLLECTION, a)] },
      [S.BOUNCED]: { description: 'برگشت چک', lines: (a) => [dr(A.RECEIVABLES, a), cr(A.NOTES_RECEIVABLE_IN_COLLECTION, a)] },
    },
    [S.BOUNCED]: {
      [S.DEPOSITED]: { description: 'ارائه مجدد چک برگشتی به بانک', lines: (a) => [dr(A.NOTES_RECEIVABLE_IN_COLLECTION, a), cr(A.RECEIVABLES, a)] },
      [S.RETURNED]: { description: 'استرداد چک برگشتی به صادرکننده', lines: null },
    },
  },
  [ChequeDirection.ISSUED]: {
    [S.REGISTERED]: {
      [S.DELIVERED]: { description: 'تحویل چک به ذی‌نفع', lines: null },
      [S.CLEARED]: { description: 'پاس شدن چک پرداختنی', lines: (a) => [dr(A.NOTES_PAYABLE, a), cr(A.BANK, a)] },
      [S.BOUNCED]: { description: 'برگشت چک صادرشده', lines: null },
      [S.RETURNED]: { description: 'ابطال و استرداد چک صادرشده', lines: (a) => [dr(A.NOTES_PAYABLE, a), cr(A.PAYABLES, a)] },
    },
    [S.DELIVERED]: {
      [S.CLEARED]: { description: 'پاس شدن چک پرداختنی', lines: (a) => [dr(A.NOTES_PAYABLE, a), cr(A.BANK, a)] },
      [S.BOUNCED]: { description: 'برگشت چک صادرشده', lines: null },
      [S.RETURNED]: { description: 'ابطال و استرداد چک صادرشده', lines: (a) => [dr(A.NOTES_PAYABLE, a), cr(A.PAYABLES, a)] },
    },
    [S.BOUNCED]: {
      [S.CLEARED]: { description: 'پاس شدن چک پرداختنی پس از برگشت', lines: (a) => [dr(A.NOTES_PAYABLE, a), cr(A.BANK, a)] },
      [S.RETURNED]: { description: 'ابطال و استرداد چک برگشتی صادرشده', lines: (a) => [dr(A.NOTES_PAYABLE, a), cr(A.PAYABLES, a)] },
    },
  },
};

export function findRule(direction: ChequeDirection, from: ChequeStatus, to: ChequeStatus): Rule | null {
  return TABLE[direction][from]?.[to] ?? null;
}

export function allowedTargets(direction: ChequeDirection, from: ChequeStatus): ChequeStatus[] {
  return Object.keys(TABLE[direction][from] ?? {}) as ChequeStatus[];
}

/**
 * Partial payment (the bank pays part of the face value). Only from a state where the cheque is
 * still being collected, and never from an endorsed or closed one. The cheque keeps its status and
 * its `settledAmount` grows; the move that finally closes it posts only the remainder.
 *
 * Legal basis: the Iranian cheque law lets the holder accept partial payment (and the bank issues the
 * certificate for the rest). No such text is in docs/legal_sources/iran/, so the rule is `unclear` and
 * flagged for the lawyer in docs/accounting/CHEQUES.md; the ledger effect follows the clearing entry.
 */
export function partialPaymentPosting(
  direction: ChequeDirection,
  from: ChequeStatus,
  amount: bigint,
): { description: string; lines: PostingLine[] } | null {
  if (direction === ChequeDirection.RECEIVED) {
    if (from === S.REGISTERED) return { description: 'وصول بخشی از چک (ارائه مستقیم در بانک)', lines: [dr(A.BANK, amount), cr(A.NOTES_RECEIVABLE_IN_HAND, amount)] };
    if (from === S.DEPOSITED) return { description: 'وصول بخشی از چک', lines: [dr(A.BANK, amount), cr(A.NOTES_RECEIVABLE_IN_COLLECTION, amount)] };
    return null;
  }
  if (from === S.REGISTERED || from === S.DELIVERED || from === S.BOUNCED) {
    return { description: 'پرداخت بخشی از چک صادرشده', lines: [dr(A.NOTES_PAYABLE, amount), cr(A.BANK, amount)] };
  }
  return null;
}

/** A cheque with a payment already taken cannot be endorsed on. */
export const BLOCKED_AFTER_PARTIAL: ChequeStatus[] = [S.SPENT];

/** Posting at creation: received cheque enters notes-in-hand, issued cheque enters notes payable. */
export function creationPosting(direction: ChequeDirection, amount: bigint): { description: string; lines: PostingLine[] } {
  return direction === ChequeDirection.RECEIVED
    ? { description: 'دریافت چک', lines: [dr(A.NOTES_RECEIVABLE_IN_HAND, amount), cr(A.RECEIVABLES, amount)] }
    : { description: 'صدور چک', lines: [dr(A.PAYABLES, amount), cr(A.NOTES_PAYABLE, amount)] };
}

/** Statuses that still await action: a bounced cheque stays open until it is cleared or returned. */
export const OPEN_STATUSES: ChequeStatus[] = [S.REGISTERED, S.DELIVERED, S.DEPOSITED, S.BOUNCED];
