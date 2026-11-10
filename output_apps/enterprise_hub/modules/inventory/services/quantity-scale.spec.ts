import { BadRequestException } from '@nestjs/common';
import { assertValidQuantityScale, QUANTITY_SCALE } from '../constants/inventory.constants';
import { layerRaise, splitShare, allocateLandedCost, LandedCostBasis } from '../purchasing/landed-cost.domain';

describe('Quantity scale enforcement and landed-cost remainder (#500)', () => {
  describe('assertValidQuantityScale', () => {
    it('accepts integer quantities', () => {
      expect(() => assertValidQuantityScale(0)).not.toThrow();
      expect(() => assertValidQuantityScale(1)).not.toThrow();
      expect(() => assertValidQuantityScale(100)).not.toThrow();
    });

    it('accepts up to 2 decimal places (QUANTITY_SCALE = 2)', () => {
      expect(() => assertValidQuantityScale(1.1)).not.toThrow();
      expect(() => assertValidQuantityScale(1.25)).not.toThrow();
      expect(() => assertValidQuantityScale(0.01)).not.toThrow();
      expect(() => assertValidQuantityScale(999.99)).not.toThrow();
    });

    it('refuses rather than rounds quantities with more than 2 decimal places (e.g. 1.125)', () => {
      expect(() => assertValidQuantityScale(1.125)).toThrow(BadRequestException);
      expect(() => assertValidQuantityScale(1.125)).toThrow(/حداکثر 2 رقم اعشار/);
      expect(() => assertValidQuantityScale(0.001)).toThrow(BadRequestException);
      expect(() => assertValidQuantityScale(12.3456)).toThrow(BadRequestException);
    });

    it('refuses negative or non-finite quantities', () => {
      expect(() => assertValidQuantityScale(-1)).toThrow(BadRequestException);
      expect(() => assertValidQuantityScale(NaN)).toThrow(BadRequestException);
      expect(() => assertValidQuantityScale(Infinity)).toThrow(BadRequestException);
    });
  });

  describe('Landed cost remainder booked to COGS', () => {
    it('reconciles FIFO layer valuation with GL inventory line down to 0 rials difference', () => {
      // 3 units on hand (300 hundredths), landed cost share of 100 minor units.
      const share = 100n;
      const remainingHundredths = 300n;
      const lineQuantity = 300n;

      const split = splitShare(share, lineQuantity, remainingHundredths);
      expect(split.toInventory).toBe(100n);
      expect(split.toCogs).toBe(0n);

      const { raisePerUnit, remainder } = layerRaise(split.toInventory, remainingHundredths);
      // 100 minor units over 3 units -> 33 minor units per whole unit
      expect(raisePerUnit).toBe(33n);
      // Remainder = 100 - (33 * 300) / 100 = 100 - 99 = 1 minor unit
      expect(remainder).toBe(1n);

      // Book remainder to COGS:
      const toInventory = split.toInventory - remainder;
      const toCogs = split.toCogs + remainder;

      expect(toInventory).toBe(99n);
      expect(toCogs).toBe(1n);
      expect(toInventory + toCogs).toBe(share);

      // Physical FIFO layer valuation increase:
      // 3 units (300 hundredths) * 33 minor units / 100 = 99 minor units.
      const layerValuationIncrease = (remainingHundredths * raisePerUnit) / 100n;
      expect(layerValuationIncrease).toBe(toInventory); // Exactly 99n! Discrepancy is 0 rials!
    });

    it('splits late freight with partial sold and fractional remainder cleanly', () => {
      // 10 units received (1000 hundredths), 4 sold, 6 remaining (600 hundredths).
      // Landed cost share: 1,000,000 minor units.
      const share = 1_000_000n;
      const lineQuantity = 1000n;
      const remainingHundredths = 600n;

      const split = splitShare(share, lineQuantity, remainingHundredths);
      // 60% still in inventory: 600,000; 40% sold: 400,000
      expect(split.toInventory).toBe(600_000n);
      expect(split.toCogs).toBe(400_000n);

      const { raisePerUnit, remainder } = layerRaise(split.toInventory, remainingHundredths);
      expect(raisePerUnit).toBe(100_000n);
      expect(remainder).toBe(0n);

      const toInventory = split.toInventory - remainder;
      const toCogs = split.toCogs + remainder;
      expect(toInventory).toBe(600_000n);
      expect(toCogs).toBe(400_000n);
      expect(toInventory + toCogs).toBe(share);
    });
  });
});
