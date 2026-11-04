import { CHEQUE_ACCOUNTS } from '../constants/cheque.constants';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { BuildInput, RoleAccounts } from '../../posting_rules/domain/posting-engine';
import { PostingRuleError } from '../../posting_rules/domain/posting-error';

/**
 * The document types of the posting engine this mapper covers. They mirror the cheque entries the
 * lifecycle posts today (see `cheque-lifecycle.ts`): creation, deposit and clearing of a received
 * cheque, and creation and clearing of an issued one.
 */
export const CHEQUE_POSTING_DOC_TYPES = [
  'cheque.received.create',
  'cheque.received.deposit',
  'cheque.received.clear',
  'cheque.issued.create',
  'cheque.issued.clear',
] as const;

export type ChequePostingDocType = (typeof CHEQUE_POSTING_DOC_TYPES)[number];

/**
 * Legacy cheque accounts bound to their posting role, per document type. Passing them as the role
 * mapping keeps every voucher byte-for-byte what `cheques.service.ts` posts today (the engine's
 * global defaults use other codes: 1021 / 2011 / 1012). The engine still resolves the accounts by
 * role, so an explicit override can replace any of them.
 */
const LEGACY_ROLE_ACCOUNTS: Readonly<Record<ChequePostingDocType, RoleAccounts>> = {
  'cheque.received.create': {
    cheques_receivable: CHEQUE_ACCOUNTS.NOTES_RECEIVABLE_IN_HAND,
    receivable: CHEQUE_ACCOUNTS.RECEIVABLES,
  },
  'cheque.received.deposit': {
    cheques_in_collection: CHEQUE_ACCOUNTS.NOTES_RECEIVABLE_IN_COLLECTION,
    cheques_receivable: CHEQUE_ACCOUNTS.NOTES_RECEIVABLE_IN_HAND,
  },
  'cheque.received.clear': {
    bank: CHEQUE_ACCOUNTS.BANK,
    cheques_in_collection: CHEQUE_ACCOUNTS.NOTES_RECEIVABLE_IN_COLLECTION,
  },
  'cheque.issued.create': {
    payable: CHEQUE_ACCOUNTS.PAYABLES,
    cheques_payable: CHEQUE_ACCOUNTS.NOTES_PAYABLE,
  },
  'cheque.issued.clear': {
    cheques_payable: CHEQUE_ACCOUNTS.NOTES_PAYABLE,
    bank: CHEQUE_ACCOUNTS.BANK,
  },
};

/** A cheque state change that has (or may have) a ledger effect. */
export interface ChequeStatusChange {
  direction: ChequeDirection;
  /** Status before the move; `null` when the cheque is first created (status becomes registered). */
  from: ChequeStatus | null;
  /** Status after the move. */
  to: ChequeStatus;
  /** Amount the move posts, integer minor units (bigint), never a float. */
  amount: bigint;
  /** Drawer / supplier party code; the engine carries it on the voucher's party lines. */
  partyCode?: string;
  /** Explicit account per role; wins over the legacy cheque-account mapping. */
  overrides?: RoleAccounts;
}

/**
 * The document type a move posts through, or `null` when the move has no automatic voucher
 * (status-only moves such as `registered -> delivered`, or a transition the lifecycle refuses).
 */
export function chequePostingDocType(
  direction: ChequeDirection,
  from: ChequeStatus | null,
  to: ChequeStatus,
): ChequePostingDocType | null {
  if (from === null) {
    if (to !== ChequeStatus.REGISTERED) return null;
    return direction === ChequeDirection.RECEIVED ? 'cheque.received.create' : 'cheque.issued.create';
  }
  if (direction === ChequeDirection.RECEIVED) {
    if (from === ChequeStatus.REGISTERED && to === ChequeStatus.DEPOSITED) return 'cheque.received.deposit';
    if (from === ChequeStatus.DEPOSITED && to === ChequeStatus.CLEARED) return 'cheque.received.clear';
    return null;
  }
  if (to === ChequeStatus.CLEARED && (from === ChequeStatus.REGISTERED || from === ChequeStatus.DELIVERED || from === ChequeStatus.BOUNCED)) {
    return 'cheque.issued.clear';
  }
  return null;
}

/**
 * Pure mapper from a cheque status change to a `buildProposal` input. The account codes are not
 * hardcoded on the lines; the engine resolves each role against the legacy cheque mapping (or a
 * caller override), so `buildProposal(chequePostingProposal(change))` reproduces the voucher the
 * cheque service posts today. Amounts stay `bigint` minor units end to end.
 */
export function chequePostingProposal(change: ChequeStatusChange): BuildInput {
  const docType = chequePostingDocType(change.direction, change.from, change.to);
  if (!docType) {
    throw new PostingRuleError(
      'UNKNOWN_DOC_TYPE',
      `انتقال چک از «${change.from ?? 'ثبت'}» به «${change.to}» سند ثبت خودکار ندارد.`,
    );
  }
  return {
    docType,
    amounts: { amount: change.amount },
    mapping: LEGACY_ROLE_ACCOUNTS[docType],
    ...(change.overrides ? { overrides: change.overrides } : {}),
    ...(change.partyCode ? { partyCode: change.partyCode } : {}),
  };
}
