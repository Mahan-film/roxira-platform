import { buildProposal } from '../../posting_rules/domain/posting-engine';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';

/** Amounts are integer minor units (bigint), never floats; see accounting/money.ts. */
export interface PostingLine {
  accountCode: string;
  debit: bigint;
  credit: bigint;
}

type Rule = {
  /** Posting rules document type (see posting_rules/domain/cheque-templates.ts); null = status change only. */
  docType: string | null;
  description: string;
};

/**
 * The lines a document type posts with the role default accounts (no tenant mapping): used by
 * tests and previews. Real postings go through PostingRulesService so a tenant's mapping applies.
 */
export function linesFor(docType: string, amount: bigint): PostingLine[] {
  return buildProposal({ docType, amounts: { amount } }).lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit }));
}

const S = ChequeStatus;

/**
 * Transition table: direction -> from -> to -> rule.
 * Account resolution happens per tenant through `PostingRulesService` using roles
 * (`cheques_receivable`, `cheques_in_collection`, `cheques_payable`, `bank`, `receivable`, `payable`),
 * defaulting to `iran-chart-template.ts` (1021 / 1023 / 2011 / 1012 / 1020 / 2010).
 *
 * Received:  registered Dr cheques_receivable / Cr receivable (at creation)
 *            deposited  Dr cheques_in_collection / Cr cheques_receivable
 *            cleared    Dr bank / Cr cheques_in_collection
 *            bounced    Dr receivable / Cr cheques_in_collection   (receivable is restored)
 *            counter presentation (registered -> cleared / bounced, no deposit step):
 *                       cleared Dr bank / Cr cheques_receivable; bounced Dr receivable / Cr cheques_receivable
 *            re-deposit Dr cheques_in_collection / Cr receivable   (bounced -> deposited)
 *            spent      Dr payable / Cr cheques_receivable   (endorsed to a supplier)
 *            returned   Dr receivable / Cr cheques_receivable   (from registered); no entry from bounced
 * Issued:    registered Dr payable / Cr cheques_payable   (at creation)
 *            delivered  status only (handed to the payee; liability unchanged)
 *            cleared    Dr cheques_payable / Cr bank   (from registered, delivered or bounced)
 *            returned   Dr cheques_payable / Cr payable
 *            bounced    status only (the bank did not pay, the liability stays)
 */
const TABLE: Record<ChequeDirection, Partial<Record<ChequeStatus, Partial<Record<ChequeStatus, Rule>>>>> = {
  [ChequeDirection.RECEIVED]: {
    [S.REGISTERED]: {
      [S.DEPOSITED]: { description: 'واگذاری چک به بانک برای وصول', docType: 'cheque.received.deposit' },
      [S.CLEARED]: { description: 'وصول چک (ارائه مستقیم در بانک)', docType: 'cheque.received.clear_direct' },
      [S.BOUNCED]: { description: 'برگشت چک (ارائه مستقیم در بانک)', docType: 'cheque.received.bounce_direct' },
      [S.SPENT]: { description: 'خرج چک به شخص ثالث', docType: 'cheque.received.spend' },
      [S.RETURNED]: { description: 'استرداد چک به صادرکننده', docType: 'cheque.received.return' },
    },
    [S.DEPOSITED]: {
      [S.CLEARED]: { description: 'وصول چک', docType: 'cheque.received.clear' },
      [S.BOUNCED]: { description: 'برگشت چک', docType: 'cheque.received.bounce' },
    },
    [S.BOUNCED]: {
      [S.DEPOSITED]: { description: 'ارائه مجدد چک برگشتی به بانک', docType: 'cheque.received.redeposit' },
      [S.RETURNED]: { description: 'استرداد چک برگشتی به صادرکننده', docType: null },
    },
  },
  [ChequeDirection.ISSUED]: {
    [S.REGISTERED]: {
      [S.DELIVERED]: { description: 'تحویل چک به ذی‌نفع', docType: null },
      [S.CLEARED]: { description: 'پاس شدن چک پرداختنی', docType: 'cheque.issued.clear' },
      [S.BOUNCED]: { description: 'برگشت چک صادرشده', docType: null },
      [S.RETURNED]: { description: 'ابطال و استرداد چک صادرشده', docType: 'cheque.issued.return' },
    },
    [S.DELIVERED]: {
      [S.CLEARED]: { description: 'پاس شدن چک پرداختنی', docType: 'cheque.issued.clear' },
      [S.BOUNCED]: { description: 'برگشت چک صادرشده', docType: null },
      [S.RETURNED]: { description: 'ابطال و استرداد چک صادرشده', docType: 'cheque.issued.return' },
    },
    [S.BOUNCED]: {
      [S.CLEARED]: { description: 'پاس شدن چک پرداختنی پس از برگشت', docType: 'cheque.issued.clear' },
      [S.RETURNED]: { description: 'ابطال و استرداد چک برگشتی صادرشده', docType: 'cheque.issued.return' },
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
): { description: string; docType: string; lines: PostingLine[] } | null {
  const make = (description: string, docType: string) => ({ description, docType, lines: linesFor(docType, amount) });
  if (direction === ChequeDirection.RECEIVED) {
    if (from === S.REGISTERED) return make('وصول بخشی از چک (ارائه مستقیم در بانک)', 'cheque.received.clear_direct');
    if (from === S.DEPOSITED) return make('وصول بخشی از چک', 'cheque.received.clear');
    return null;
  }
  if (from === S.REGISTERED || from === S.DELIVERED || from === S.BOUNCED) {
    return make('پرداخت بخشی از چک صادرشده', 'cheque.issued.clear');
  }
  return null;
}

/** A cheque with a payment already taken cannot be endorsed on. */
export const BLOCKED_AFTER_PARTIAL: ChequeStatus[] = [S.SPENT];

/** Posting at creation: received cheque enters notes-in-hand, issued cheque enters notes payable. */
export function creationPosting(direction: ChequeDirection, amount: bigint): { description: string; docType: string; lines: PostingLine[] } {
  const received = direction === ChequeDirection.RECEIVED;
  const docType = received ? 'cheque.received.create' : 'cheque.issued.create';
  return { description: received ? 'دریافت چک' : 'صدور چک', docType, lines: linesFor(docType, amount) };
}

/** Statuses that still await action: a bounced cheque stays open until it is cleared or returned. */
export const OPEN_STATUSES: ChequeStatus[] = [S.REGISTERED, S.DELIVERED, S.DEPOSITED, S.BOUNCED];
