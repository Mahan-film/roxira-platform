/* Frozen copy of the bank voucher building before the posting rules engine (#230), kept only to prove the engine posts the same lines. Do not edit. */
export interface LegacyBankLine {
  accountCode: string;
  debit: bigint;
  credit: bigint;
}

/**
 * The two lines the reconciliation-draft and manual-entry sites posted with `createJournalEntry`:
 * the bank account against the counter account. Money in debits the bank (bank first); money out
 * credits it. Amounts are integer minor units (bigint), never floats; see accounting/money.ts.
 */
export function legacyBankLines(direction: 'in' | 'out', amount: bigint, bank: string, counter: string): LegacyBankLine[] {
  const isIn = direction === 'in';
  return [
    { accountCode: bank, debit: isIn ? amount : 0n, credit: isIn ? 0n : amount },
    { accountCode: counter, debit: isIn ? 0n : amount, credit: isIn ? amount : 0n },
  ];
}
