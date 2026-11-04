import { TreasuryDocKind } from '../enums/treasury.enum';
import { TREASURY_ACCOUNTS as A } from '../constants/treasury.constants';
import { DocumentPostingInput, TreasuryLine, buildAdvanceAllocationLines, buildDocumentLines } from './treasury-lines';

const sum = (lines: TreasuryLine[], side: 'debit' | 'credit') => lines.reduce((s, l) => s + l[side], 0n);
const balanced = (lines: TreasuryLine[]) => expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));

const base = (over: Partial<DocumentPostingInput>): DocumentPostingInput => ({
  kind: TreasuryDocKind.RECEIPT,
  partyCode: 'C1',
  funds: [{ accountCode: A.CASH, amount: 1000n }],
  chequeTotal: 0n,
  applied: 1000n,
  writeoff: 0n,
  advance: 0n,
  ...over,
});

describe('buildDocumentLines', () => {
  it('receipt: cash against the receivable of the party', () => {
    const lines = buildDocumentLines(base({}));
    expect(lines).toEqual([
      { accountCode: A.CASH, debit: 1000n, credit: 0n },
      { accountCode: A.RECEIVABLES, debit: 0n, credit: 1000n, partyCode: 'C1' },
    ]);
  });

  it('payment is the mirror image', () => {
    const lines = buildDocumentLines(base({ kind: TreasuryDocKind.PAYMENT }));
    expect(lines).toEqual([
      { accountCode: A.CASH, debit: 0n, credit: 1000n },
      { accountCode: A.PAYABLES, debit: 1000n, credit: 0n, partyCode: 'C1' },
    ]);
  });

  it('books the unallocated part as an advance and the write-off as a discount', () => {
    const receipt = buildDocumentLines(base({ funds: [{ accountCode: A.CASH, amount: 1000n }], applied: 600n, writeoff: 5n, advance: 400n }));
    balanced(receipt);
    expect(receipt.find((l) => l.accountCode === A.CUSTOMER_ADVANCES)?.credit).toBe(400n);
    expect(receipt.find((l) => l.accountCode === A.WRITEOFF_RECEIPT)?.debit).toBe(5n);
    const payment = buildDocumentLines(base({ kind: TreasuryDocKind.PAYMENT, applied: 600n, writeoff: 5n, advance: 400n }));
    balanced(payment);
    expect(payment.find((l) => l.accountCode === A.SUPPLIER_ADVANCES)?.debit).toBe(400n);
    expect(payment.find((l) => l.accountCode === A.WRITEOFF_PAYMENT)?.credit).toBe(5n);
  });

  it('mixed cash + bank + cheque posts only the non-cheque funds (the cheque module posted its part)', () => {
    const lines = buildDocumentLines(
      base({ funds: [{ accountCode: A.CASH, amount: 300n }, { accountCode: A.BANK, amount: 200n }], chequeTotal: 500n, applied: 1000n }),
    );
    balanced(lines);
    expect(lines.find((l) => l.accountCode === A.RECEIVABLES)?.credit).toBe(500n);
  });

  it('a cheque larger than the allocation flips the receivable to a debit and the rest is an advance', () => {
    const lines = buildDocumentLines(base({ funds: [], chequeTotal: 1000n, applied: 400n, advance: 600n }));
    balanced(lines);
    expect(lines.find((l) => l.accountCode === A.RECEIVABLES)).toMatchObject({ debit: 600n, credit: 0n });
  });

  it('is balanced for a grid of amounts', () => {
    for (const kind of [TreasuryDocKind.RECEIPT, TreasuryDocKind.PAYMENT]) {
      for (const cheque of [0n, 250n, 1000n]) {
        for (const applied of [0n, 300n, 1000n]) {
          for (const writeoff of [0n, 7n]) {
            const total = 1000n;
            const lines = buildDocumentLines({
              kind,
              partyCode: 'P',
              funds: total - cheque > 0n ? [{ accountCode: A.CASH, amount: total - cheque }] : [],
              chequeTotal: cheque,
              applied,
              writeoff,
              advance: total - applied,
            });
            balanced(lines);
            expect(lines.every((l) => (l.debit === 0n) !== (l.credit === 0n))).toBe(true);
          }
        }
      }
    }
  });
});

describe('buildAdvanceAllocationLines', () => {
  it('receipt: advance liability against receivable, with write-off', () => {
    const lines = buildAdvanceAllocationLines({ kind: TreasuryDocKind.RECEIPT, partyCode: 'C1', applied: 700n, writeoff: 10n });
    balanced(lines);
    expect(lines.find((l) => l.accountCode === A.CUSTOMER_ADVANCES)?.debit).toBe(700n);
    expect(lines.find((l) => l.accountCode === A.RECEIVABLES)?.credit).toBe(710n);
  });

  it('payment: payable against supplier advance', () => {
    const lines = buildAdvanceAllocationLines({ kind: TreasuryDocKind.PAYMENT, partyCode: 'S1', applied: 700n, writeoff: 0n });
    balanced(lines);
    expect(lines.find((l) => l.accountCode === A.PAYABLES)?.debit).toBe(700n);
    expect(lines.find((l) => l.accountCode === A.SUPPLIER_ADVANCES)?.credit).toBe(700n);
  });
});
