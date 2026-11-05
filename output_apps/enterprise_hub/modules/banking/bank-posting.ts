import { buildProposal, ProposalLine } from '../posting_rules/domain/posting-engine';

/** Direction of a bank move: money into the account (`in`) or out of it (`out`). */
export type BankDirection = 'in' | 'out';

/** The posting-rules document type of a bank move: a receipt when money comes in, a payment when it goes out. */
export function bankDocType(direction: BankDirection): 'bank.receipt' | 'bank.payment' {
  return direction === 'in' ? 'bank.receipt' : 'bank.payment';
}

export interface BankPostingAccounts {
  /** Ledger code of the bank account (its own account, the money line). */
  bank: string;
  /** Ledger code of the counter account (the reason for the move, from the rule or category). */
  counter: string;
}

/**
 * The lines a bank move posts with the given accounts and no tenant mapping: used by tests and
 * previews. Real postings go through `PostingRulesService.post` so a tenant's mapping applies.
 * Money in debits the bank and credits the counter; money out reverses the two.
 */
export function bankPostingLines(
  direction: BankDirection,
  amount: bigint,
  accounts: BankPostingAccounts,
  partyCode?: string,
): { docType: string; lines: ProposalLine[] } {
  const docType = bankDocType(direction);
  const proposal = buildProposal({
    docType,
    amounts: { amount },
    overrides: { bank: accounts.bank, counter: accounts.counter },
    partyCode,
  });
  return { docType, lines: proposal.lines };
}
