import { AllocationError, AllocationRequest, OpenItem, planAllocation, suggestFifo } from './allocation-engine';

const item = (targetId: string, outstanding: number): OpenItem => ({ targetId, outstanding: BigInt(outstanding) });
const req = (targetId: string, amount: number, writeoff = 0): AllocationRequest => ({
  targetId,
  amount: BigInt(amount),
  writeoff: BigInt(writeoff),
});
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as AllocationError).code;
  }
  return undefined;
};

describe('planAllocation', () => {
  it('settles one invoice in full', () => {
    const plan = planAllocation({ available: 1000n, items: [item('a', 1000)], requests: [req('a', 1000)], tolerance: 0n });
    expect(plan).toMatchObject({ applied: 1000n, writeoffTotal: 0n, advance: 0n });
  });

  it('settles one invoice partially and leaves the rest open', () => {
    const plan = planAllocation({ available: 400n, items: [item('a', 1000)], requests: [req('a', 400)], tolerance: 0n });
    expect(plan.applied).toBe(400n);
    expect(plan.advance).toBe(0n);
  });

  it('pays several invoices with one payment', () => {
    const plan = planAllocation({
      available: 1500n,
      items: [item('a', 1000), item('b', 500)],
      requests: [req('a', 1000), req('b', 500)],
      tolerance: 0n,
    });
    expect(plan.applied).toBe(1500n);
    expect(plan.rows).toHaveLength(2);
  });

  it('lets several payments settle one invoice: the second sees the reduced outstanding', () => {
    // first payment took 600 of 1000; the repository reports 400 outstanding for the second
    const second = planAllocation({ available: 400n, items: [item('a', 400)], requests: [req('a', 400)], tolerance: 0n });
    expect(second.applied).toBe(400n);
    expect(codeOf(() => planAllocation({ available: 500n, items: [item('a', 400)], requests: [req('a', 500)], tolerance: 0n }))).toBe(
      'OVER_OUTSTANDING',
    );
  });

  it('keeps unallocated money as an advance', () => {
    const plan = planAllocation({ available: 1000n, items: [item('a', 300)], requests: [req('a', 300)], tolerance: 0n });
    expect(plan.advance).toBe(700n);
    const none = planAllocation({ available: 1000n, items: [], requests: [], tolerance: 0n });
    expect(none.advance).toBe(1000n);
  });

  it('allocates an advance later with the same rules', () => {
    const later = planAllocation({ available: 700n, items: [item('b', 900)], requests: [req('b', 700)], tolerance: 0n });
    expect(later.advance).toBe(0n);
  });

  it('writes off a small difference that closes the invoice, within tolerance', () => {
    const plan = planAllocation({ available: 990n, items: [item('a', 1000)], requests: [req('a', 990, 10)], tolerance: 50n });
    expect(plan).toMatchObject({ applied: 990n, writeoffTotal: 10n, advance: 0n });
  });

  it('refuses a write-off above the tolerance, or when tolerance is zero', () => {
    expect(codeOf(() => planAllocation({ available: 900n, items: [item('a', 1000)], requests: [req('a', 900, 100)], tolerance: 50n }))).toBe(
      'WRITEOFF_ABOVE_TOLERANCE',
    );
    expect(codeOf(() => planAllocation({ available: 990n, items: [item('a', 1000)], requests: [req('a', 990, 10)], tolerance: 0n }))).toBe(
      'WRITEOFF_ABOVE_TOLERANCE',
    );
  });

  it('refuses a write-off that does not close the invoice', () => {
    expect(codeOf(() => planAllocation({ available: 500n, items: [item('a', 1000)], requests: [req('a', 500, 10)], tolerance: 50n }))).toBe(
      'WRITEOFF_NOT_CLOSING',
    );
  });

  it('refuses over-allocation, duplicates, unknown invoices, negatives and empty rows', () => {
    const base = { items: [item('a', 1000)], tolerance: 0n };
    expect(codeOf(() => planAllocation({ ...base, available: 500n, requests: [req('a', 600)] }))).toBe('OVER_AVAILABLE');
    expect(codeOf(() => planAllocation({ ...base, available: 2000n, requests: [req('a', 1001)] }))).toBe('OVER_OUTSTANDING');
    expect(codeOf(() => planAllocation({ ...base, available: 2000n, requests: [req('a', 1), req('a', 2)] }))).toBe('DUPLICATE_TARGET');
    expect(codeOf(() => planAllocation({ ...base, available: 2000n, requests: [req('zz', 1)] }))).toBe('UNKNOWN_TARGET');
    expect(codeOf(() => planAllocation({ ...base, available: 2000n, requests: [req('a', -1)] }))).toBe('NEGATIVE_AMOUNT');
    expect(codeOf(() => planAllocation({ ...base, available: 2000n, requests: [req('a', 0)] }))).toBe('EMPTY_ROW');
  });
});

describe('suggestFifo', () => {
  it('fills oldest first, skips settled items and leaves the rest as an advance', () => {
    const rows = suggestFifo(1200n, [item('old', 1000), item('paid', 0), item('new', 500)]);
    expect(rows.map((r) => [r.targetId, r.amount])).toEqual([
      ['old', 1000n],
      ['new', 200n],
    ]);
    expect(suggestFifo(100n, [item('a', 1000)])[0].amount).toBe(100n);
    expect(suggestFifo(100n, [])).toEqual([]);
  });
});
