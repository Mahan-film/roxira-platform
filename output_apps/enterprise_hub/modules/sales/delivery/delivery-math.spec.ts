import { hundredthsToNumber, fulfilmentStatus, overallFulfilmentStatus, unitCostMinor } from './delivery-math';

describe('delivery maths', () => {
  it('hundredthsToNumber is exact for every two-decimal quantity', () => {
    expect(hundredthsToNumber(400n)).toBe(4);
    expect(hundredthsToNumber(0n)).toBe(0);
    expect(hundredthsToNumber(250n)).toBe(2.5);
    expect(hundredthsToNumber(5n)).toBe(0.05);
    expect(hundredthsToNumber(1100n)).toBe(11);
  });

  it('unitCostMinor divides the line cost exactly when the quantity allows it', () => {
    expect(unitCostMinor(400000n, 400n)).toBe(100000n); // 4000 rials / 4 = 1000
    expect(unitCostMinor(240000n, 200n)).toBe(120000n); // 2400 / 2 = 1200
    expect(unitCostMinor(0n, 400n)).toBe(0n);
    expect(unitCostMinor(700000n, 600n)).toBe(116667n); // 7000 / 6 = 1166.67, half-up
  });

  it('unitCostMinor rounds half-up on the nearest hundredth and never below zero', () => {
    expect(unitCostMinor(100n, 300n)).toBe(33n); // 1.00 / 3 = 0.3333 -> 0.33
    expect(unitCostMinor(200n, 300n)).toBe(67n); // 2.00 / 3 = 0.6666 -> 0.67
    expect(unitCostMinor(1n, 2n)).toBe(50n); // 0.01 / 0.02 = 0.50
  });

  it('unitCostMinor refuses a zero or negative quantity', () => {
    expect(() => unitCostMinor(100n, 0n)).toThrow();
    expect(() => unitCostMinor(100n, -1n)).toThrow();
  });

  it('fulfilmentStatus classifies a line by its delivered hundredths', () => {
    expect(fulfilmentStatus(0n, 1200n)).toBe('NONE');
    expect(fulfilmentStatus(400n, 1200n)).toBe('PARTIAL');
    expect(fulfilmentStatus(1200n, 1200n)).toBe('COMPLETE');
    expect(fulfilmentStatus(1200n, 600n)).toBe('COMPLETE'); // defensive: never above ordered
  });

  it('overallFulfilmentStatus aggregates the lines of an order', () => {
    expect(overallFulfilmentStatus([])).toBe('NONE');
    expect(overallFulfilmentStatus(['NONE', 'NONE'])).toBe('NONE');
    expect(overallFulfilmentStatus(['COMPLETE', 'COMPLETE'])).toBe('COMPLETE');
    expect(overallFulfilmentStatus(['COMPLETE', 'NONE'])).toBe('PARTIAL');
    expect(overallFulfilmentStatus(['PARTIAL', 'NONE'])).toBe('PARTIAL');
  });
});
