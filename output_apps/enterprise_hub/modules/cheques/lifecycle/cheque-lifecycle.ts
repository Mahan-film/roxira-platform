import { CHEQUE_ACCOUNTS } from '../constants/cheque.constants';
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
const A = CHEQUE_ACCOUNTS;

const S = ChequeStatus;

/**
 * Transition table: direction -> from -> to -> rule.
 *
 * Received:  registered Dr 1110 / Cr 1020 (at creation)
 *            deposited  Dr 1120 / Cr 1110
 *            cleared    Dr 1010 / Cr 1120
 *            bounced    Dr 1020 / Cr 1120   (receivable is restored)
 *            counter presentation (registered -> cleared / bounced, no deposit step):
 *                       cleared Dr 1010 / Cr 1110; bounced Dr 1020 / Cr 1110
 *            re-deposit Dr 1120 / Cr 1020   (bounced -> deposited)
 *            spent      Dr 2010 / Cr 1110   (endorsed to a supplier)
 *            returned   Dr 1020 / Cr 1110   (from registered); no entry from bounced
 * Issued:    registered Dr 2010 / Cr 2110   (at creation)
 *            cleared    Dr 2110 / Cr 1010
 *            returned   Dr 2110 / Cr 2010
 *            bounced    status only (the bank did not pay, the liability stays)
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

/** Posting at creation: received cheque enters notes-in-hand, issued cheque enters notes payable. */
export function creationPosting(direction: ChequeDirection, amount: bigint): { description: string; lines: PostingLine[] } {
  return direction === ChequeDirection.RECEIVED
    ? { description: 'دریافت چک', lines: [dr(A.NOTES_RECEIVABLE_IN_HAND, amount), cr(A.RECEIVABLES, amount)] }
    : { description: 'صدور چک', lines: [dr(A.PAYABLES, amount), cr(A.NOTES_PAYABLE, amount)] };
}

/** Statuses that still await action: a bounced cheque stays open until it is cleared or returned. */
export const OPEN_STATUSES: ChequeStatus[] = [S.REGISTERED, S.DEPOSITED, S.BOUNCED];
