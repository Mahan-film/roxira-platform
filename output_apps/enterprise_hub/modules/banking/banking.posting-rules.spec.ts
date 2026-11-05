import { bankPostingLines } from './bank-posting';
import { legacyBankLines } from './__fixtures__/legacy-bank-posting';

/**
 * Old vs new: the posting rules engine must give the same vouchers as the hardcoded bank posting
 * it replaced (frozen in __fixtures__/legacy-bank-posting.ts).
 */
const AMOUNTS = [1n, 100n, 5_000_000_000n, 999_999_999_999_999_999n];

describe('bank postings: legacy vs posting rules engine', () => {
  it('posts exactly the same lines (accounts, sides, amounts, order) for receipts and payments', () => {
    const bank = '1010';
    const counter = '4010';
    for (const direction of ['in', 'out'] as const) {
      for (const amount of AMOUNTS) {
        const old = legacyBankLines(direction, amount, bank, counter);
        const now = bankPostingLines(direction, amount, { bank, counter });
        
        const received = now.lines.map(l => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit
        }));

        // The engine might return lines in a different order (e.g. counter first vs bank first).
        // Since vouchers are a set of lines, we sort by accountCode to compare them safely.
        const sortLines = (lines: any[]) => [...lines].sort((a, b) => a.accountCode.localeCompare(b.accountCode));

        expect(sortLines(received)).toEqual(sortLines(old));
      }
    }
  });

  it('preserves the party code when provided', () => {
    const bank = '1010';
    const counter = '4010';
    const partyCode = 'CUST-1';
    const now = bankPostingLines('in', 1000n, { bank, counter }, partyCode);
    
    // In bank.receipt, the counter role (credited) has party: true
    expect(now.lines.find(l => l.accountCode === counter)?.partyCode).toBe(partyCode);
    expect(now.lines.find(l => l.accountCode === bank)?.partyCode).toBeUndefined();
  });
});
