import { computeLine, parseQuantityHundredths, SalesMathError, sumLineTotals } from './sales-math';

describe('sales-math', () => {
  describe('parseQuantityHundredths', () => {
    it('reads a decimal with up to two decimals as hundredths', () => {
      expect(parseQuantityHundredths('2.5')).toBe(250n);
      expect(parseQuantityHundredths(3)).toBe(300n);
      expect(parseQuantityHundredths('0.01')).toBe(1n);
    });

    it('refuses more than two decimals instead of rounding (#500)', () => {
      expect(() => parseQuantityHundredths('1.125')).toThrow(SalesMathError);
      expect(() => parseQuantityHundredths('1.125')).toThrow(/two decimals|2 decimals/);
    });

    it('refuses zero and negative quantities', () => {
      expect(() => parseQuantityHundredths(0)).toThrow(SalesMathError);
      expect(() => parseQuantityHundredths('-1')).toThrow(SalesMathError);
    });
  });

  describe('computeLine', () => {
    it('multiplies quantity by price and rounds half-up (2.5 x 40,000 = 100,000 rials)', () => {
      expect(computeLine(250n, 4_000_000n, 0n)).toBe(10_000_000n);
    });

    it('subtracts the line discount (3 x 12,500 less 1,500 = 36,000 rials)', () => {
      expect(computeLine(300n, 1_250_000n, 150_000n)).toBe(3_600_000n);
    });

    it('rounds half-up on the minor unit: 0.01 x 0.01 stays 0, 0.5 minor rounds up', () => {
      expect(computeLine(1n, 1n, 0n)).toBe(0n);
      expect(computeLine(50n, 1n, 0n)).toBe(1n);
    });

    it('refuses a discount above the gross amount', () => {
      expect(() => computeLine(1n, 100n, 200n)).toThrow(SalesMathError);
    });
  });

  it('sums line totals exactly', () => {
    expect(sumLineTotals([10_000_000n, 3_600_000n])).toBe(13_600_000n);
    expect(sumLineTotals([])).toBe(0n);
  });
});
