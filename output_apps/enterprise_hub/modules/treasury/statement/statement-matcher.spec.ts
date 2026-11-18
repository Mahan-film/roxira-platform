import { mentions, normaliseText, OpenInvoice, suggestMatch } from './statement-matcher';

const open: OpenInvoice[] = [
  { id: 'i101', number: 'INV-101', outstanding: 119000n, date: '2026-10-20' },
  { id: 'i102', number: 'INV-102', outstanding: 60000n, date: '2026-10-21' },
  { id: 'i103', number: 'INV-103', outstanding: 40000n, date: '2026-10-22' },
];
const line = (amountMinor: bigint, reference: string, bookingDate = '2026-11-02') => ({ amountMinor, reference, bookingDate });

describe('suggestMatch (Test 9)', () => {
  it('TX-1: exact reference with an equal amount is automatic', () => {
    const s = suggestMatch(line(119000n, 'Payment for INV-101'), open);
    expect(s).toMatchObject({ rule: 'reference', auto: true, feeMinor: 0n });
    expect(s?.allocations).toEqual([{ invoiceId: 'i101', invoiceNumber: 'INV-101', amountMinor: 119000n }]);
  });

  it('TX-2: two referenced invoices, 970.00 paid for 1,000.00 open: 30.00 proposed as fee, not automatic', () => {
    const s = suggestMatch(line(97000n, 'INV-102 INV-103 net of 30.00 bank fee'), open);
    expect(s).toMatchObject({ rule: 'reference', auto: false, feeMinor: 3000n });
    expect(s?.allocations.map((a) => [a.invoiceNumber, a.amountMinor])).toEqual([
      ['INV-102', 60000n],
      ['INV-103', 40000n],
    ]);
    expect(s?.explanation).toContain('30.00');
  });

  it('several referenced invoices paid in full together are automatic', () => {
    expect(suggestMatch(line(100000n, 'INV-102/INV-103'), open)).toMatchObject({ auto: true, feeMinor: 0n });
  });

  it('a large shortfall is a partial payment, oldest invoice first, never automatic', () => {
    const s = suggestMatch(line(70000n, 'INV-102 INV-103'), open);
    expect(s).toMatchObject({ rule: 'reference', auto: false, feeMinor: 0n });
    expect(s?.allocations.map((a) => [a.invoiceNumber, a.amountMinor])).toEqual([
      ['INV-102', 60000n],
      ['INV-103', 10000n],
    ]);
  });

  it('an overpayment of the named invoices gives no suggestion', () => {
    expect(suggestMatch(line(150000n, 'INV-102 INV-103'), open)).toBeNull();
  });

  it('amount + date window: one open invoice of that amount within the window is suggested, never automatic', () => {
    const s = suggestMatch(line(40000n, 'thanks'), open);
    expect(s).toMatchObject({ rule: 'amount_date', auto: false, feeMinor: 0n });
    expect(s?.allocations[0].invoiceNumber).toBe('INV-103');
  });

  it('outside the window, on a tie, or without a date: no suggestion', () => {
    expect(suggestMatch(line(40000n, 'x', '2026-12-30'), open)).toBeNull();
    const twin = [...open, { id: 'i104', number: 'INV-104', outstanding: 40000n, date: '2026-10-25' }];
    expect(suggestMatch(line(40000n, 'x'), twin)).toBeNull();
    expect(suggestMatch(line(40000n, 'x'), [{ id: 'a', number: 'A-1', outstanding: 40000n, date: null }])).toBeNull();
  });

  it('is deterministic and ignores settled invoices and non-positive amounts', () => {
    const settled = [{ ...open[0], outstanding: 0n }, ...open.slice(1)];
    expect(suggestMatch(line(119000n, 'INV-101'), settled)).toBeNull();
    expect(suggestMatch(line(0n, 'INV-101'), open)).toBeNull();
    expect(JSON.stringify(suggestMatch(line(97000n, 'INV-103 INV-102'), open), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(
      JSON.stringify(suggestMatch(line(97000n, 'INV-102 INV-103'), open), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
  });
});

describe('reference tokens', () => {
  it('matches whole tokens only', () => {
    expect(mentions('INV-1011', 'INV-101')).toBe(false);
    expect(mentions('XINV-101', 'INV-101')).toBe(false);
    expect(mentions('INV-101,', 'INV-101')).toBe(true);
    expect(mentions('INV-101 INV-1011', 'INV-101')).toBe(true);
    expect(mentions('12', '12')).toBe(false); // too short to be a reliable reference
  });

  it('normalises Persian and Arabic-Indic digits and case', () => {
    expect(normaliseText('inv-۱۰۱ ٢')).toBe('INV-101 2');
    expect(mentions(normaliseText('پرداخت inv-۱۰۱'), 'INV-101')).toBe(true);
  });
});
