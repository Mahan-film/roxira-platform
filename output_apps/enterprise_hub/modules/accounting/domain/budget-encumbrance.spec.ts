import { evaluateBudgetEncumbrance } from './budget-encumbrance';

describe('evaluateBudgetEncumbrance (T194)', () => {
  it('returns OK when utilization is below 80%', () => {
    const decision = evaluateBudgetEncumbrance({
      budgetMinor: 500_000n,
      actualSpendMinor: 0n,
      committedMinor: 0n,
      newAmountMinor: 390_000n, // 78%
    });
    expect(decision.status).toBe('OK');
    expect(decision.allowed).toBe(true);
    expect(decision.utilizationPercent).toBe(78);
    expect(decision.remainingMinor).toBe(110_000n);
    expect(decision.warning).toBeUndefined();
  });

  it('returns WARN at >= 80% and <= 100%', () => {
    const decision = evaluateBudgetEncumbrance({
      budgetMinor: 500_000n,
      actualSpendMinor: 0n,
      committedMinor: 0n,
      newAmountMinor: 420_000n, // 84%
    });
    expect(decision.status).toBe('WARN');
    expect(decision.allowed).toBe(true);
    expect(decision.utilizationPercent).toBe(84);
    expect(decision.remainingMinor).toBe(80_000n);
    expect(decision.warning).toContain('84%');
  });

  it('returns BLOCK when projected total exceeds 100%', () => {
    const decision = evaluateBudgetEncumbrance({
      budgetMinor: 500_000n,
      actualSpendMinor: 0n,
      committedMinor: 420_000n,
      newAmountMinor: 100_000n, // 104%
    });
    expect(decision.status).toBe('BLOCK');
    expect(decision.allowed).toBe(false);
    expect(decision.utilizationPercent).toBe(104);
    expect(decision.remainingMinor).toBe(-20_000n);
  });

  it('passes with remaining balance after budget revision', () => {
    const decision = evaluateBudgetEncumbrance({
      budgetMinor: 550_000n,
      actualSpendMinor: 0n,
      committedMinor: 420_000n,
      newAmountMinor: 100_000n, // 520_000 / 550_000 = 94%
    });
    expect(decision.status).toBe('WARN');
    expect(decision.allowed).toBe(true);
    expect(decision.remainingMinor).toBe(30_000n);
  });
});
