import { TREASURY_ACCOUNTS } from '../constants/treasury.constants';
import { TreasuryDocKind } from '../enums/treasury.enum';

/** One ledger line in integer minor units. Exactly one of debit/credit is non-zero. */
export interface TreasuryLine {
  accountCode: string;
  debit: bigint;
  credit: bigint;
  partyCode?: string;
}

/** Money that moved through a non-cheque method: its own ledger account and amount. */
export interface FundLine {
  accountCode: string;
  amount: bigint;
}

export interface DocumentPostingInput {
  kind: TreasuryDocKind;
  partyCode: string;
  funds: readonly FundLine[];
  /**
   * Cheque amounts. The cheques module already posted them against the party's receivable or
   * payable when the cheque was registered, so only the difference to the allocated amount is
   * posted here.
   */
  chequeTotal: bigint;
  /** Money applied to invoices (cash part). */
  applied: bigint;
  writeoff: bigint;
  /** Document total minus `applied`. */
  advance: bigint;
}

const line = (accountCode: string, debit: bigint, credit: bigint, partyCode?: string): TreasuryLine => ({
  accountCode,
  debit,
  credit,
  ...(partyCode ? { partyCode } : {}),
});

/**
 * Lines of a receipt or payment. A receipt debits the money accounts and credits the receivable
 * (and the advance liability for the unallocated rest); a payment is the exact mirror.
 *
 * Balance proof (receipt): debits = (total - cheque) + writeoff; credits = (applied + writeoff -
 * cheque) + (total - applied) = total + writeoff - cheque. The receivable line goes to the debit
 * side when the cheque is larger than what is applied (the cheque over-credited the party).
 */
export function buildDocumentLines(input: DocumentPostingInput): TreasuryLine[] {
  const receipt = input.kind === TreasuryDocKind.RECEIPT;
  const party = input.partyCode;
  const partyAccount = receipt ? TREASURY_ACCOUNTS.RECEIVABLES : TREASURY_ACCOUNTS.PAYABLES;
  const advanceAccount = receipt ? TREASURY_ACCOUNTS.CUSTOMER_ADVANCES : TREASURY_ACCOUNTS.SUPPLIER_ADVANCES;
  const writeoffAccount = receipt ? TREASURY_ACCOUNTS.WRITEOFF_RECEIPT : TREASURY_ACCOUNTS.WRITEOFF_PAYMENT;

  // "money side" is where the funds go (receipt: debit), "party side" the opposite.
  const out: TreasuryLine[] = [];
  const money = (account: string, amount: bigint, partyCode?: string) =>
    out.push(receipt ? line(account, amount, 0n, partyCode) : line(account, 0n, amount, partyCode));
  const against = (account: string, amount: bigint, partyCode?: string) =>
    out.push(receipt ? line(account, 0n, amount, partyCode) : line(account, amount, 0n, partyCode));

  for (const fund of input.funds) if (fund.amount > 0n) money(fund.accountCode, fund.amount);

  // A write-off is a discount: a debit on a receipt (expense side), a credit on a payment (income).
  if (input.writeoff > 0n) {
    out.push(receipt ? line(writeoffAccount, input.writeoff, 0n) : line(writeoffAccount, 0n, input.writeoff));
  }

  const partyNet = input.applied + input.writeoff - input.chequeTotal;
  if (partyNet > 0n) against(partyAccount, partyNet, party);
  else if (partyNet < 0n) money(partyAccount, -partyNet, party);

  if (input.advance > 0n) against(advanceAccount, input.advance, party);
  return out;
}

export interface AdvanceAllocationInput {
  kind: TreasuryDocKind;
  partyCode: string;
  /** Advance moved onto invoices. */
  applied: bigint;
  writeoff: bigint;
}

/** Moves an advance onto invoices: advance account against the party account (plus write-off). */
export function buildAdvanceAllocationLines(input: AdvanceAllocationInput): TreasuryLine[] {
  const receipt = input.kind === TreasuryDocKind.RECEIPT;
  const party = input.partyCode;
  const partyAccount = receipt ? TREASURY_ACCOUNTS.RECEIVABLES : TREASURY_ACCOUNTS.PAYABLES;
  const advanceAccount = receipt ? TREASURY_ACCOUNTS.CUSTOMER_ADVANCES : TREASURY_ACCOUNTS.SUPPLIER_ADVANCES;
  const writeoffAccount = receipt ? TREASURY_ACCOUNTS.WRITEOFF_RECEIPT : TREASURY_ACCOUNTS.WRITEOFF_PAYMENT;
  const settled = input.applied + input.writeoff;

  const out: TreasuryLine[] = [];
  if (receipt) {
    if (input.applied > 0n) out.push(line(advanceAccount, input.applied, 0n, party));
    if (input.writeoff > 0n) out.push(line(writeoffAccount, input.writeoff, 0n));
    out.push(line(partyAccount, 0n, settled, party));
  } else {
    out.push(line(partyAccount, settled, 0n, party));
    if (input.applied > 0n) out.push(line(advanceAccount, 0n, input.applied, party));
    if (input.writeoff > 0n) out.push(line(writeoffAccount, 0n, input.writeoff));
  }
  return out;
}
