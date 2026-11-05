import { ageing, AgeingAllocationSource, AgeingInputError, AgeingLine, ageingBuckets } from './ageing';

const line = (
  day: string,
  debit: bigint,
  credit: bigint,
  partyCode: string | null = 'C1',
  accountCode = '1301',
): AgeingLine => ({ accountCode, accountName: 'حساب‌های دریافتنی', partyCode, day, debit, credit });

describe('ageingBuckets', () => {
  it('builds inclusive ranges with an open last bucket', () => {
    expect(ageingBuckets([30, 60, 90])).toEqual([
      { fromDay: 0, toDay: 30 },
      { fromDay: 31, toDay: 60 },
      { fromDay: 61, toDay: 90 },
      { fromDay: 91, toDay: null },
    ]);
  });

  it.each([[[0]], [[30, 30]], [[60, 30]], [[1.5]]])('rejects bad edges %j', (edges) => {
    expect(() => ageingBuckets(edges)).toThrow(AgeingInputError);
  });
});

describe('ageing', () => {
  const asOf = '2026-11-01';

  it('puts each open receivable in the bucket of its age (bounds inclusive)', () => {
    const report = ageing(
      [
        line('2026-11-01', 100n, 0n), // 0 days
        line('2026-10-02', 200n, 0n), // 30 days
        line('2026-10-01', 300n, 0n), // 31 days
        line('2026-08-03', 400n, 0n), // 90 days
        line('2026-08-02', 500n, 0n), // 91 days
      ],
      { side: 'receivable', asOf },
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].amounts).toEqual([300n, 300n, 400n, 500n]);
    expect(report.rows[0].oldestOpenDay).toBe('2026-08-02');
    expect(report.totals.balance).toBe(1500n);
  });

  it('settles the oldest items first (FIFO), including partial settlement', () => {
    const report = ageing(
      [
        line('2026-07-01', 1000n, 0n), // 123 days
        line('2026-10-20', 500n, 0n), // 12 days
        line('2026-10-25', 0n, 1200n), // pays all of the first and 200 of the second
      ],
      { side: 'receivable', asOf },
    );
    const row = report.rows[0];
    expect(row.amounts).toEqual([300n, 0n, 0n, 0n]);
    expect(row.unapplied).toBe(0n);
    expect(row.balance).toBe(300n);
    expect(row.oldestOpenDay).toBe('2026-10-20');
  });

  it('keeps an overpayment as unapplied and uses it on the next item', () => {
    const early = ageing([line('2026-09-01', 100n, 0n), line('2026-09-05', 0n, 250n)], {
      side: 'receivable',
      asOf,
    });
    expect(early.rows[0]).toMatchObject({ open: 0n, unapplied: 150n, balance: -150n, oldestOpenDay: null });

    const later = ageing(
      [line('2026-09-01', 100n, 0n), line('2026-09-05', 0n, 250n), line('2026-10-30', 400n, 0n)],
      { side: 'receivable', asOf },
    );
    expect(later.rows[0]).toMatchObject({ open: 250n, unapplied: 0n, balance: 250n });
    expect(later.rows[0].amounts).toEqual([250n, 0n, 0n, 0n]);
  });

  it('ages payables from credit lines', () => {
    const report = ageing(
      [line('2026-09-15', 0n, 800n, 'S1', '3101'), line('2026-10-10', 300n, 0n, 'S1', '3101')],
      { side: 'payable', asOf },
    );
    expect(report.rows[0]).toMatchObject({ accountCode: '3101', partyCode: 'S1', open: 500n, balance: 500n });
    expect(report.rows[0].amounts).toEqual([0n, 500n, 0n, 0n]); // 2026-09-15 is 47 days old
  });

  it('ages each account and party separately and lists lines without a party last', () => {
    const report = ageing(
      [
        line('2026-10-01', 10n, 0n, null),
        line('2026-10-01', 20n, 0n, 'B'),
        line('2026-10-01', 30n, 0n, 'A'),
        line('2026-10-01', 40n, 0n, 'A', '1302'),
        line('2026-10-02', 0n, 30n, 'B'), // B's payment never touches A
      ],
      { side: 'receivable', asOf },
    );
    expect(report.rows.map((row) => [row.accountCode, row.partyCode, row.balance])).toEqual([
      ['1301', 'A', 30n],
      ['1301', 'B', -10n],
      ['1301', null, 10n],
      ['1302', 'A', 40n],
    ]);
    expect(report.totals).toMatchObject({ open: 80n, unapplied: 10n, balance: 70n });
  });

  it('ignores lines after asOf and drops settled pairs', () => {
    const report = ageing(
      [line('2026-10-01', 100n, 0n), line('2026-10-05', 0n, 100n), line('2026-11-02', 999n, 0n)],
      { side: 'receivable', asOf },
    );
    expect(report.rows).toEqual([]);
    expect(report.totals.balance).toBe(0n);
  });

  it('balance equals debit minus credit for every pair (receivable)', () => {
    // Deterministic pseudo-random ledger: the bucket split may vary, the balance may not.
    let seed = 7;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    const lines: AgeingLine[] = [];
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.UTC(2026, 0, 1) + (next() % 300) * 86_400_000).toISOString().slice(0, 10);
      const amount = BigInt(next() % 100_000);
      const party = ['A', 'B', 'C', null][next() % 4];
      lines.push(next() % 3 === 0 ? line(day, 0n, amount, party) : line(day, amount, 0n, party));
    }
    const report = ageing(lines, { side: 'receivable', asOf, edges: [15, 45, 120, 200] });
    for (const row of report.rows) {
      const net = lines
        .filter((l) => l.partyCode === row.partyCode)
        .reduce((sum, l) => sum + l.debit - l.credit, 0n);
      expect(row.balance).toBe(net);
      expect(row.amounts.reduce((sum, value) => sum + value, 0n)).toBe(row.open);
      expect(row.open === 0n || row.unapplied === 0n).toBe(true);
    }
  });

  describe('with an allocation source (#237)', () => {
    const invoices = [
      { ...line('2026-07-01', 1000n, 0n), ref: 'INV-1' }, // 123 days
      { ...line('2026-10-20', 500n, 0n), ref: 'INV-2' }, // 12 days
    ];
    const receipt = { ...line('2026-10-25', 0n, 500n), ref: 'RCV-1' };

    it('a payment allocated to the newest invoice leaves the oldest in its old bucket', () => {
      const source: AgeingAllocationSource = (settlement) =>
        settlement.ref === 'RCV-1' ? [{ itemRef: 'INV-2', amount: 500n }] : [];
      const row = ageing([...invoices, receipt], { side: 'receivable', asOf, allocations: source }).rows[0];
      expect(row.amounts).toEqual([0n, 0n, 0n, 1000n]);
      expect(row.oldestOpenDay).toBe('2026-07-01');
      // FIFO, the default, would have paid half of the oldest instead.
      expect(ageing([...invoices, receipt], { side: 'receivable', asOf }).rows[0].amounts).toEqual([500n, 0n, 0n, 500n]);
    });

    it('settles what the source does not cover, or an unknown ref, oldest first', () => {
      const source: AgeingAllocationSource = () => [
        { itemRef: 'INV-2', amount: 200n },
        { itemRef: 'NO-SUCH', amount: 100n },
      ];
      const row = ageing([...invoices, { ...receipt, credit: 1600n }], { side: 'receivable', asOf, allocations: source })
        .rows[0];
      expect(row.amounts).toEqual([0n, 0n, 0n, 0n]);
      expect(row.unapplied).toBe(100n);
      expect(row.balance).toBe(-100n);
    });
  });

  it('rejects an invalid asOf or line day', () => {
    expect(() => ageing([], { side: 'receivable', asOf: '2026-02-30' })).toThrow(AgeingInputError);
    expect(() => ageing([line('2026-13-01', 1n, 0n)], { side: 'receivable', asOf })).toThrow(AgeingInputError);
  });
});
