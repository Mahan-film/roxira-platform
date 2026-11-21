export type StatementFormat = 'camt053' | 'mt940';
export type StatementDirection = 'credit' | 'debit';

/** One booked movement of the bank account, from the bank's point of view. */
export interface ParsedStatementLine {
  /** The bank's own transaction id (AcctSvcrRef / NtryRef, or the :61: bank reference). */
  bankTxnId: string;
  /** YYYY-MM-DD. */
  bookingDate: string;
  valueDate: string | null;
  /** Always positive, integer minor units; the sign is `direction`. */
  amountMinor: bigint;
  /** credit = money in (a deposit), debit = money out. */
  direction: StatementDirection;
  currency: string | null;
  /** Remittance information / customer reference text: what invoice numbers are matched against. */
  reference: string;
  counterparty: string | null;
}

export interface ParsedStatement {
  format: StatementFormat;
  /** MsgId/Stmt Id (CAMT) or :20: reference (MT940). */
  statementId: string | null;
  /** IBAN or account number from the file, for the caller to compare with the chosen bank account. */
  accountRef: string | null;
  currency: string | null;
  lines: ParsedStatementLine[];
}

export class StatementParseError extends Error {}
