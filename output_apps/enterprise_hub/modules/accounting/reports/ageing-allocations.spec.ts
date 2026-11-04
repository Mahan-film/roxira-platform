import { AgeingLine } from './ageing';
import { allocationSource } from './ageing-allocations';

const settlement = (ref: string | null, credit: bigint): AgeingLine => ({
  accountCode: '1020',
  accountName: 'دریافتنی',
  partyCode: 'C1',
  day: '2026-10-25',
  debit: 0n,
  credit,
  ref,
});

describe('allocationSource', () => {
  it('hands out a document’s allocations across its ledger lines without applying any twice', () => {
    const source = allocationSource([
      { documentId: 7, invoiceId: 'A', amount: 300, writeoff: '0' },
      { documentId: 7, invoiceId: 'B', amount: '150.50', writeoff: 0.5 },
    ]);
    // The receipt voucher credits the party in two lines: 400 and 51.
    expect(source(settlement('trs:7', 40_000n))).toEqual([
      { itemRef: 'inv:A', amount: 30_000n },
      { itemRef: 'inv:B', amount: 10_000n },
    ]);
    expect(source(settlement('trs:7', 5_100n))).toEqual([{ itemRef: 'inv:B', amount: 5_100n }]);
    expect(source(settlement('trs:7', 100n))).toEqual([]);
  });

  it('settles an invoice by its own paid or cancel posting, and leaves other lines to FIFO', () => {
    const source = allocationSource([]);
    expect(source(settlement('settle:A', 900n))).toEqual([{ itemRef: 'inv:A', amount: 900n }]);
    expect(source(settlement('trs:9', 900n))).toEqual([]);
    expect(source(settlement(null, 900n))).toEqual([]);
  });
});
