import {
  calculateRasgiri,
  calculateSingleDiscount,
  calculateChequesDiscounting,
  diffInDays,
  addDaysToYmd,
  normalizeDateToYmd,
  formatToJalali,
  toBigIntAmount,
} from './utils/cheque-calculator.util';

describe('Cheque Ras-giri & Discounting Calculator (T72)', () => {
  describe('Date & Math Utilities', () => {
    it('normalizes Date and string to YYYY-MM-DD', () => {
      expect(normalizeDateToYmd('2026-11-11')).toBe('2026-11-11');
      expect(normalizeDateToYmd('2026-11-11T15:30:00.000Z')).toBe('2026-11-11');
      expect(normalizeDateToYmd(new Date('2026-12-05T00:00:00.000Z'))).toBe('2026-12-05');
    });

    it('calculates integer difference in days between dates', () => {
      expect(diffInDays('2026-11-10', '2026-11-20')).toBe(10);
      expect(diffInDays('2026-11-20', '2026-11-10')).toBe(-10);
      expect(diffInDays('2026-11-10', '2026-11-10')).toBe(0);
      // Month boundary
      expect(diffInDays('2026-11-01', '2026-12-01')).toBe(30);
    });

    it('adds integer days to YYYY-MM-DD correctly', () => {
      expect(addDaysToYmd('2026-11-10', 10)).toBe('2026-11-20');
      expect(addDaysToYmd('2026-11-10', 30)).toBe('2026-12-10');
      expect(addDaysToYmd('2026-11-10', -5)).toBe('2026-11-05');
    });

    it('formats Gregorian YYYY-MM-DD to Jalali YYYY/MM/DD', () => {
      const jalali = formatToJalali('2026-11-11');
      expect(jalali).toMatch(/^1405\/08\/\d{2}$/);
    });

    it('parses large amounts to BigInt accurately without IEEE 754 precision loss', () => {
      const largeStr = '987654321098765432';
      expect(toBigIntAmount(largeStr).toString()).toBe(largeStr);
      expect(toBigIntAmount('1,000,000,000')).toBe(1000000000n);
      expect(toBigIntAmount(50000000)).toBe(50000000n);
    });
  });

  describe('calculateRasgiri (راس‌گیری چک)', () => {
    it('returns exact maturity days for a single cheque', () => {
      const baseDate = '2026-11-01';
      const result = calculateRasgiri(
        [
          {
            id: 1,
            amount: '100000000',
            dueDate: '2026-11-21', // 20 days later
          },
        ],
        baseDate,
      );

      expect(result.totalCount).toBe(1);
      expect(result.totalAmount).toBe('100000000');
      expect(result.weightedAverageDays).toBe(20);
      expect(result.weightedMaturityDate).toBe('2026-11-21');
      expect(result.items[0].weightPercent).toBe(100);
      expect(result.items[0].days).toBe(20);
    });

    it('computes exact arithmetic mean when cheque amounts are equal', () => {
      const baseDate = '2026-11-01';
      // 10 days and 30 days -> average = 20 days
      const result = calculateRasgiri(
        [
          { amount: '50000000', dueDate: '2026-11-11' }, // 10 days
          { amount: '50000000', dueDate: '2026-12-01' }, // 30 days
        ],
        baseDate,
      );

      expect(result.totalCount).toBe(2);
      expect(result.totalAmount).toBe('100000000');
      expect(result.weightedAverageDays).toBe(20);
      expect(result.weightedMaturityDate).toBe('2026-11-21');
      expect(result.items[0].weightPercent).toBe(50);
      expect(result.items[1].weightPercent).toBe(50);
    });

    it('weights towards larger cheque amounts', () => {
      const baseDate = '2026-11-01';
      // Cheque 1: 10,000,000 at 10 days (weight 10%)
      // Cheque 2: 90,000,000 at 30 days (weight 90%)
      // Expected weighted days = (10M * 10 + 90M * 30) / 100M = (100M + 2700M) / 100M = 28 days
      const result = calculateRasgiri(
        [
          { amount: '10000000', dueDate: '2026-11-11' },
          { amount: '90000000', dueDate: '2026-12-01' },
        ],
        baseDate,
      );

      expect(result.totalAmount).toBe('100000000');
      expect(result.weightedAverageDays).toBe(28);
      expect(result.weightedMaturityDate).toBe('2026-11-29');
      expect(result.items[0].weightPercent).toBe(10);
      expect(result.items[1].weightPercent).toBe(90);
    });

    it('handles rounding to nearest integer day (half-up rule)', () => {
      const baseDate = '2026-11-01';
      // Cheque 1: 10,000,000 at 10 days
      // Cheque 2: 20,000,000 at 20 days
      // Product: 100M + 400M = 500M / 30M = 16.666... days -> rounds to 17 days
      const result = calculateRasgiri(
        [
          { amount: '10000000', dueDate: '2026-11-11' },
          { amount: '20000000', dueDate: '2026-11-21' },
        ],
        baseDate,
      );

      expect(result.weightedAverageDays).toBe(17);
      expect(result.weightedMaturityDate).toBe('2026-11-18');
    });

    it('handles multi-cheque portfolio with large commercial amounts (BigInt)', () => {
      const baseDate = '2026-10-01';
      const items = [
        { amount: '50000000000', dueDate: '2026-11-01' }, // 50B Rial, 31 days
        { amount: '100000000000', dueDate: '2026-12-01' }, // 100B Rial, 61 days
        { amount: '150000000000', dueDate: '2026-12-31' }, // 150B Rial, 91 days
      ];
      // Total = 300B
      // Sum = 50B*31 + 100B*61 + 150B*91 = 1550B + 6100B + 13650B = 21300B
      // Avg days = 21300B / 300B = 71 days
      const result = calculateRasgiri(items, baseDate);

      expect(result.totalAmount).toBe('300000000000');
      expect(result.weightedAverageDays).toBe(71);
      expect(result.weightedMaturityDate).toBe('2026-12-11');
    });

    it('throws error for empty list or invalid amounts', () => {
      expect(() => calculateRasgiri([])).toThrow('حداقل یک فقره چک');
      expect(() => calculateRasgiri([{ amount: '0', dueDate: '2026-11-11' }])).toThrow(
        'بزرگ‌تر از صفر',
      );
      expect(() => calculateRasgiri([{ amount: '-500', dueDate: '2026-11-11' }])).toThrow(
        'بزرگ‌تر از صفر',
      );
    });
  });

  describe('calculateSingleDiscount (تنزیل تک چک)', () => {
    it('returns zero discount if days is 0 or rate is 0', () => {
      const res1 = calculateSingleDiscount('100000000', 0, 24);
      expect(res1.discountAmount).toBe(0n);
      expect(res1.netPresentValue).toBe(100000000n);

      const res2 = calculateSingleDiscount('100000000', 90, 0);
      expect(res2.discountAmount).toBe(0n);
      expect(res2.netPresentValue).toBe(100000000n);
    });

    it('computes exact discount based on 365 days annual formula', () => {
      // Amount: 365,000,000 Rial, Rate: 10% annual, Days: 365
      // Expected discount: 365M * 0.10 * 365 / 365 = 36,500,000 Rial
      const res = calculateSingleDiscount('365000000', 365, 10);
      expect(res.discountAmount).toBe(36500000n);
      expect(res.netPresentValue).toBe(328500000n);
      expect(res.effectivePeriodRatePercent).toBe(10);
    });

    it('computes realistic Iranian commercial banking discount (24% annual, 90 days)', () => {
      // Amount: 1,000,000,000 Rial (100M Toman)
      // Rate: 24% annual
      // Days: 90
      // Formula: 1,000,000,000 * 24 * 90 / 36500 = 59,178,082.19... -> 59,178,082 Rials
      const res = calculateSingleDiscount('1000000000', 90, 24);
      expect(res.discountAmount).toBe(59178082n);
      expect(res.netPresentValue).toBe(940821918n);
      expect(res.effectivePeriodRatePercent).toBe(5.92);
    });

    it('caps discount amount at face value', () => {
      // If someone enters an extreme rate or very long days, discount cannot exceed amount
      const res = calculateSingleDiscount('1000000', 1000, 100);
      expect(res.discountAmount).toBe(1000000n);
      expect(res.netPresentValue).toBe(0n);
    });

    it('throws error for negative rate or non-positive amount', () => {
      expect(() => calculateSingleDiscount('1000000', 30, -5)).toThrow('نمی‌تواند منفی باشد');
      expect(() => calculateSingleDiscount('0', 30, 20)).toThrow('بزرگ‌تر از صفر');
    });
  });

  describe('calculateChequesDiscounting (تنزیل پرتفوی چک‌ها)', () => {
    it('computes portfolio discounting and matches sum of individual discounts', () => {
      const baseDate = '2026-11-01';
      const items = [
        { id: 1, amount: '500000000', dueDate: '2026-12-01' }, // 30 days
        { id: 2, amount: '500000000', dueDate: '2026-12-31' }, // 60 days
      ];
      // 24% annual rate
      const result = calculateChequesDiscounting(items, 24, baseDate);

      expect(result.totalAmount).toBe('1000000000');
      expect(result.annualRatePercent).toBe(24);
      expect(result.weightedAverageDays).toBe(45); // (30+60)/2 = 45 days

      // Cheque 1: 500M * 24 * 30 / 36500 = 9,863,014
      // Cheque 2: 500M * 24 * 60 / 36500 = 19,726,027
      // Total discount = 29,589,041
      expect(result.items[0].discountAmount).toBe('9863014');
      expect(result.items[1].discountAmount).toBe('19726027');
      expect(result.totalDiscountAmount).toBe('29589041');
      expect(result.netPresentValue).toBe('970410959');
    });
  });
});
