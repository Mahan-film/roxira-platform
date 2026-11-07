import { GoodsReceiptLine } from './purchase.types';
import {
  allocateLandedCost,
  basisWeight,
  LandedCostBasis,
  LandedCostError,
  layerRaise,
  splitShare,
} from './landed-cost.domain';

function line(overrides: Partial<GoodsReceiptLine> = {}): GoodsReceiptLine {
  return {
    id: overrides.id ?? 'line-1',
    orderLineId: 'order-line-1',
    sku: 'A',
    quantity: 1000n,
    unitCost: 1_000_000n,
    value: 10_000_000n,
    weight: null,
    fifoBatchId: 1,
    ...overrides,
  };
}

describe('landed cost allocation (#227 T2)', () => {
  describe('allocateLandedCost', () => {
    it('splits freight by VALUE in exact proportion (hand-computed)', () => {
      const lines = [
        line({ id: 'l1', sku: 'A', value: 6_000_000n, quantity: 300n }),
        line({ id: 'l2', sku: 'B', value: 4_000_000n, quantity: 100n }),
      ];
      const shares = allocateLandedCost(1_000_000n, lines, LandedCostBasis.VALUE);
      expect(shares.map((share) => share.share)).toEqual([600_000n, 400_000n]);
      expect(shares.map((share) => share.basisValue)).toEqual([6_000_000n, 4_000_000n]);
    });

    it('splits by QUANTITY with quantities 3.00 and 1.00 (hand-computed)', () => {
      const lines = [
        line({ id: 'l1', quantity: 300n, value: 6_000_000n }),
        line({ id: 'l2', quantity: 100n, value: 4_000_000n }),
      ];
      const shares = allocateLandedCost(1_000_000n, lines, LandedCostBasis.QUANTITY);
      expect(shares.map((share) => share.share)).toEqual([750_000n, 250_000n]);
    });

    it('splits by WEIGHT and refuses a line without a weight', () => {
      const lines = [
        line({ id: 'l1', weight: 4000n }),
        line({ id: 'l2', weight: 1000n }),
      ];
      const shares = allocateLandedCost(1_000_000n, lines, LandedCostBasis.WEIGHT);
      expect(shares.map((share) => share.share)).toEqual([800_000n, 200_000n]);

      expect(() => allocateLandedCost(1n, [line({ weight: null })], LandedCostBasis.WEIGHT)).toThrow(
        LandedCostError,
      );
      try {
        allocateLandedCost(1n, [line({ weight: null })], LandedCostBasis.WEIGHT);
      } catch (error) {
        expect((error as LandedCostError).code).toBe('MISSING_WEIGHT');
      }
    });

    it('gives the remainder minor units to the largest fractional parts, ties in line order (34/33/33)', () => {
      const lines = [
        line({ id: 'l1', value: 1_000_000n }),
        line({ id: 'l2', value: 1_000_000n }),
        line({ id: 'l3', value: 1_000_000n }),
      ];
      const shares = allocateLandedCost(100n, lines, LandedCostBasis.VALUE);
      expect(shares.map((share) => share.share)).toEqual([34n, 33n, 33n]);
      expect(shares.reduce((sum, share) => sum + share.share, 0n)).toBe(100n);
    });

    it('always sums exactly to the amount, even when the remainder is larger than one', () => {
      // 1,000,000 over weights 1 and 999,999: the first line keeps its full 1 minor unit.
      const lines = [line({ id: 'l1', value: 1n }), line({ id: 'l2', value: 999_999n })];
      const shares = allocateLandedCost(1_000_000n, lines, LandedCostBasis.VALUE);
      expect(shares.map((share) => share.share)).toEqual([1n, 999_999n]);
    });

    it('refuses a non-positive amount and lines that cannot carry the cost', () => {
      expect(() => allocateLandedCost(0n, [line()], LandedCostBasis.VALUE)).toThrow(LandedCostError);
      try {
        allocateLandedCost(0n, [line()], LandedCostBasis.VALUE);
      } catch (error) {
        expect((error as LandedCostError).code).toBe('INVALID_AMOUNT');
      }
      expect(() => allocateLandedCost(100n, [], LandedCostBasis.VALUE)).toThrow(LandedCostError);
      expect(() =>
        allocateLandedCost(100n, [line({ value: 0n })], LandedCostBasis.VALUE),
      ).toThrow(LandedCostError);
    });

    it('refuses an amount the ledger cannot carry', () => {
      expect(() =>
        allocateLandedCost(10n ** 18n, [line()], LandedCostBasis.VALUE),
      ).toThrow(LandedCostError);
    });
  });

  describe('splitShare', () => {
    it('sends the sold part to COGS and the rest to the layer (40% sold, hand-computed)', () => {
      const split = splitShare(1_000_000n, 1000n, 600n);
      expect(split).toEqual({ toInventory: 600_000n, toCogs: 400_000n });
    });

    it('sends everything to COGS when the layer is fully issued and everything to the layer when untouched', () => {
      expect(splitShare(1_000_000n, 1000n, 0n)).toEqual({ toInventory: 0n, toCogs: 1_000_000n });
      expect(splitShare(1_000_000n, 1000n, 1000n)).toEqual({ toInventory: 1_000_000n, toCogs: 0n });
    });

    it('never loses a minor unit on an inexact proportion', () => {
      const split = splitShare(100n, 3n, 2n);
      expect(split.toInventory + split.toCogs).toBe(100n);
      expect(split).toEqual({ toInventory: 67n, toCogs: 33n });
    });
  });

  describe('layerRaise', () => {
    it('raises the layer cost by exactly the on-hand share when it divides evenly (hand-computed)', () => {
      // 6 remaining units (600 hundredths) take 600,000 minor units: 100,000 minor per unit.
      expect(layerRaise(600_000n, 600n)).toEqual({ raisePerUnit: 100_000n, remainder: 0n });
    });

    it('keeps the rounding remainder out of the unit cost instead of losing it', () => {
      // 100 minor units over 300 hundredths: 33 minor per unit raises 99, the 1 left is the remainder.
      expect(layerRaise(100n, 300n)).toEqual({ raisePerUnit: 33n, remainder: 1n });
    });

    it('does nothing for an empty layer', () => {
      expect(layerRaise(500n, 0n)).toEqual({ raisePerUnit: 0n, remainder: 500n });
      expect(layerRaise(0n, 300n)).toEqual({ raisePerUnit: 0n, remainder: 0n });
    });
  });

  describe('basisWeight', () => {
    it('reads the right column per basis', () => {
      const row = line({ value: 7n, quantity: 9n, weight: 5n });
      expect(basisWeight(row, LandedCostBasis.VALUE)).toBe(7n);
      expect(basisWeight(row, LandedCostBasis.QUANTITY)).toBe(9n);
      expect(basisWeight(row, LandedCostBasis.WEIGHT)).toBe(5n);
    });
  });
});
