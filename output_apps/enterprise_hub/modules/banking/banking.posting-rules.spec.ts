import { bankDocType, bankPostingLines } from './bank-posting';
import { legacyBankLines } from './__fixtures__/legacy-bank-posting';

/**
 * Old vs new: the posting rules engine must give the same vouchers as the two hardcoded bank
 * posting sites it replaced (frozen in __fixtures__/legacy-bank-posting.ts), in and out, with and
 * without a party. Line order is not compared (the engine's template fixes a canonical order) but
 * the accounting content — account, side and amount — must be identical for every amount.
 */
const BANK = '1010';
const COUNTER = '5030';
const AMOUNTS = [1n, 100n, 5_000_000_00n, 999_999_999_999_999_999n];

/** The accounting content of a line, ignoring order and description. */
const content = (lines: ReadonlyArray<{ accountCode: string; debit: bigint; credit: bigint }>) =>
  lines
    .map((line) => ({ accountCode: line.accountCode, debit: line.debit, credit: line.credit }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

describe('bank postings: legacy lines vs posting rules engine', () => {
  it('maps money in to bank.receipt and money out to bank.payment', () => {
    expect(bankDocType('in')).toBe('bank.receipt');
    expect(bankDocType('out')).toBe('bank.payment');
  });

  it('posts the same two lines in and out, with and without a party', () => {
    let compared = 0;
    for (const direction of ['in', 'out'] as const) {
      for (const amount of AMOUNTS) {
        for (const partyCode of [undefined, 'C-1'] as const) {
          const legacy = legacyBankLines(direction, amount, BANK, COUNTER);
          const now = bankPostingLines(direction, amount, { bank: BANK, counter: COUNTER }, partyCode);
          expect(content(now.lines)).toEqual(content(legacy));
          // The party belongs to the counter line, never to the bank line.
          expect(now.lines.find((l) => l.accountCode === COUNTER)!.partyCode ?? undefined).toBe(partyCode);
          expect(now.lines.find((l) => l.accountCode === BANK)!.partyCode ?? undefined).toBeUndefined();
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(8);
  });

  it('names the sides: receipt debits the bank, payment credits it', () => {
    const receipt = bankPostingLines('in', 100n, { bank: BANK, counter: COUNTER });
    expect(receipt.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      [BANK, 100n, 0n],
      [COUNTER, 0n, 100n],
    ]);
    const payment = bankPostingLines('out', 100n, { bank: BANK, counter: COUNTER });
    expect(payment.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      [COUNTER, 100n, 0n],
      [BANK, 0n, 100n],
    ]);
  });

  it('refuses a zero move and a negative amount', () => {
    expect(() => bankPostingLines('in', 0n, { bank: BANK, counter: COUNTER })).toThrow(/مبلغی برای ثبت ندارد/);
    expect(() => bankPostingLines('out', -1n, { bank: BANK, counter: COUNTER })).toThrow(/منفی/);
  });
});
