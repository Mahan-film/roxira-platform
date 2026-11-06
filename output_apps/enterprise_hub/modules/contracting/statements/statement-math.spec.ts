import { netPayable, nextPeriod, StatementError } from './statement-math';

describe('nextPeriod', () => {
  it('is cumulative minus previous, over three statements of a 1,000,000,000 contract', () => {
    expect(nextPeriod(0n, 300_000_000n, 1_000_000_000n)).toBe(300_000_000n);
    expect(nextPeriod(300_000_000n, 700_000_000n, 1_000_000_000n)).toBe(400_000_000n);
    expect(nextPeriod(700_000_000n, 1_000_000_000n, 1_000_000_000n)).toBe(300_000_000n);
  });
  it('refuses a flat or falling cumulative and one above the contract', () => {
    expect(() => nextPeriod(5n, 5n, 10n)).toThrow(expect.objectContaining({ code: 'NOT_INCREASING' }));
    expect(() => nextPeriod(5n, 4n, 10n)).toThrow(StatementError);
    expect(() => nextPeriod(0n, 1_000_000_001n, 1_000_000_000n)).toThrow(expect.objectContaining({ code: 'OVER_CONTRACT' }));
  });
});

describe('netPayable', () => {
  it('subtracts retention, insurance and advance recovery', () => {
    expect(netPayable(400_000_000n, 40_000_000n, 28_000_000n, 0n)).toBe(332_000_000n);
  });
  it('refuses deductions above the period amount', () => {
    expect(() => netPayable(100n, 60n, 30n, 20n)).toThrow(expect.objectContaining({ code: 'DEDUCTIONS_EXCEED' }));
  });
});
