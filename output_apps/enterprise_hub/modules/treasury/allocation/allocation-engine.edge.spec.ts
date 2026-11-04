/**
 * Edge-case spec for the pure allocation engine. Complements allocation-engine.spec.ts:
 * only cases that are not already covered there (zero amount, remainder as advance,
 * exact match, one rial left over, many small invoices, allocation order).
 */
import { OpenItem, AllocationRequest, planAllocation, suggestFifo } from './allocation-engine';

const item = (targetId: string, outstanding: number): OpenItem => ({ targetId, outstanding: BigInt(outstanding) });
const req = (targetId: string, amount: number, writeoff = 0): AllocationRequest => ({
  targetId,
  amount: BigInt(amount),
  writeoff: BigInt(writeoff),
});

describe('planAllocation edge cases', () => {
  it('handles a zero available amount', () => {
    const empty = planAllocation({ available: 0n, items: [item('a', 1000)], requests: [], tolerance: 0n });
    expect(empty).toMatchObject({ applied: 0n, writeoffTotal: 0n, advance: 0n });
    expect(empty.rows).toEqual([]);
  });

  it('turns the remainder into an advance when the amount exceeds every open invoice', () => {
    const plan = planAllocation({
      available: 5000n,
      items: [item('a', 1000), item('b', 2000)],
      requests: [req('a', 1000), req('b', 2000)],
      tolerance: 0n,
    });
    expect(plan.applied).toBe(3000n);
    expect(plan.advance).toBe(2000n);
    expect(plan.rows).toHaveLength(2);
  });

  it('settles an exact match across several invoices with no advance', () => {
    const plan = planAllocation({
      available: 700n,
      items: [item('a', 300), item('b', 400)],
      requests: [req('a', 300), req('b', 400)],
      tolerance: 0n,
    });
    expect(plan.applied).toBe(700n);
    expect(plan.advance).toBe(0n);
    expect(plan.writeoffTotal).toBe(0n);
  });

  it('leaves exactly one rial as advance', () => {
    const plan = planAllocation({
      available: 1001n,
      items: [item('a', 1000)],
      requests: [req('a', 1000)],
      tolerance: 0n,
    });
    expect(plan.applied).toBe(1000n);
    expect(plan.advance).toBe(1n);
  });

  it('allocates across many small invoices', () => {
    const items = Array.from({ length: 50 }, (_, i) => item(`inv-${i}`, 10));
    const requests = items.map((it) => req(it.targetId, 10));
    const plan = planAllocation({ available: 500n, items, requests, tolerance: 0n });
    expect(plan.rows).toHaveLength(50);
    expect(plan.applied).toBe(500n);
    expect(plan.advance).toBe(0n);
  });

  it('preserves the request order of the allocation rows, not the item order', () => {
    const plan = planAllocation({
      available: 600n,
      items: [item('a', 300), item('b', 300)],
      requests: [req('b', 100), req('a', 200)],
      tolerance: 0n,
    });
    expect(plan.rows.map((r) => r.targetId)).toEqual(['b', 'a']);
    expect(plan.applied).toBe(300n);
    expect(plan.advance).toBe(300n);
  });
});

describe('suggestFifo edge cases', () => {
  it('returns nothing when the available amount is zero', () => {
    expect(suggestFifo(0n, [item('a', 1000), item('b', 500)])).toEqual([]);
  });

  it('follows the given oldest-first item order and stops exactly at the last full invoice', () => {
    const rows = suggestFifo(700n, [item('old', 300), item('mid', 300), item('new', 300)]);
    expect(rows.map((r) => [r.targetId, r.amount])).toEqual([
      ['old', 300n],
      ['mid', 300n],
      ['new', 100n],
    ]);
  });
});
