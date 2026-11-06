import { profitability } from './profitability';

describe('profitability', () => {
  it('budget 1,000,000,000, subcontracts 300,000,000, ledger cost 200,000,000, billed 800,000,000 (rial, x100 minor)', () => {
    const p = profitability({ budget: 100_000_000_000n, billed: 80_000_000_000n, subcontracts: 30_000_000_000n, ledgerExpense: 20_000_000_000n });
    expect(p.actual).toEqual({ subcontracts: 30_000_000_000n, ledger: 20_000_000_000n, total: 50_000_000_000n });
    expect(p.budgetRemaining).toBe(50_000_000_000n); // 1,000m - 500m
    expect(p.margin).toBe(30_000_000_000n); // 800m - 500m
    expect(p.ledgerLinked).toBe(true);
  });
  it('without a cost centre the ledger part is null (not 0) and the project is flagged unlinked', () => {
    const p = profitability({ budget: 100n, billed: 0n, subcontracts: 40n, ledgerExpense: null });
    expect(p.actual.ledger).toBeNull();
    expect(p.actual.total).toBe(40n);
    expect(p.ledgerLinked).toBe(false);
    expect(p.margin).toBe(-40n);
  });
});
