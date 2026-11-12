import 'reflect-metadata';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  calculateRasgiri,
  calculateSingleDiscount,
  calculateChequesDiscounting,
  diffInDays,
  addDaysToYmd,
  normalizeDateToYmd,
  formatToJalali,
  toCalculatorMinor,
} from './utils/cheque-calculator.util';
import {
  CalculateDiscountDto,
  CalculateRasgiriDto,
  CalculateSelectionDiscountDto,
  CalculateSingleDiscountDto,
} from './dto/cheque-calculator.dto';
import { ChequesController } from './controllers/cheques.controller';
import { AccessGuard } from '../access/access.guard';
import { SystemRole } from '../access/catalogue';
import { AccessStub } from '../../test/support/access-stub';

describe('Cheque Ras-giri & Discounting Calculator (T72)', () => {
  describe('Date & Math Utilities', () => {
    it('normalizes Date and string to YYYY-MM-DD in Asia/Tehran', () => {
      expect(normalizeDateToYmd('2026-11-11')).toBe('2026-11-11');
      expect(normalizeDateToYmd('2026-11-11T15:30:00.000Z')).toBe('2026-11-11');
      expect(normalizeDateToYmd(new Date('2026-12-05T00:00:00.000Z'))).toBe('2026-12-05');
      // 20:30 UTC is 00:00 next day in Tehran (UTC+3:30)
      expect(normalizeDateToYmd(new Date('2026-11-11T20:29:59.000Z'))).toBe('2026-11-11');
      expect(normalizeDateToYmd(new Date('2026-11-11T20:30:00.000Z'))).toBe('2026-11-12');
    });

    it('rejects impossible calendar dates', () => {
      expect(() => normalizeDateToYmd('2026-02-31')).toThrow('تاریخ نامعتبر');
    });

    it('calculates integer difference in days between dates', () => {
      expect(diffInDays('2026-11-10', '2026-11-20')).toBe(10);
      expect(diffInDays('2026-11-20', '2026-11-10')).toBe(-10);
      expect(diffInDays('2026-11-10', '2026-11-10')).toBe(0);
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

    it('parses large amounts via money.ts without IEEE 754 precision loss', () => {
      // 9007199254740993 exceeds Number.MAX_SAFE_INTEGER (9007199254740992)
      expect(toCalculatorMinor('9007199254740993').toString()).toBe('900719925474099300');
      expect(toCalculatorMinor('9876543210987654.32').toString()).toBe('987654321098765432');
      expect(toCalculatorMinor('1,000,000,000')).toBe(100000000000n);
      expect(toCalculatorMinor('۱٬۲۵۰٫۵'.replace('٫', '.'))).toBe(125050n);
      expect(toCalculatorMinor(50000000)).toBe(5000000000n);
    });
  });

  describe('calculateRasgiri (راس‌گیری چک)', () => {
    it('returns exact maturity days for a single cheque', () => {
      const baseDate = '2026-11-01';
      const result = calculateRasgiri(
        [{ id: 1, amount: '100000000', dueDate: '2026-11-21' }],
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
      const result = calculateRasgiri(
        [
          { amount: '50000000', dueDate: '2026-11-11' },
          { amount: '50000000', dueDate: '2026-12-01' },
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
        { amount: '50000000000', dueDate: '2026-11-01' },
        { amount: '100000000000', dueDate: '2026-12-01' },
        { amount: '150000000000', dueDate: '2026-12-31' },
      ];
      const result = calculateRasgiri(items, baseDate);

      expect(result.totalAmount).toBe('300000000000');
      expect(result.weightedAverageDays).toBe(71);
      expect(result.weightedMaturityDate).toBe('2026-12-11');
    });

    it('preserves exact precision above 2^53 without float drift', () => {
      const result = calculateRasgiri(
        [
          { amount: '9007199254740993', dueDate: '2026-11-11' },
          { amount: '1', dueDate: '2026-11-21' },
        ],
        '2026-11-01',
      );
      expect(result.totalAmount).toBe('9007199254740994.00');
      expect(result.weightedAverageDays).toBe(10);
    });

    it('throws BadRequestException for empty list or invalid amounts', () => {
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
      expect(res1.discountAmount).toBe('0');
      expect(res1.netPresentValue).toBe('100000000');

      const res2 = calculateSingleDiscount('100000000', 90, 0);
      expect(res2.discountAmount).toBe('0');
      expect(res2.netPresentValue).toBe('100000000');
    });

    it('computes exact discount based on 365 days annual formula', () => {
      const res = calculateSingleDiscount('365000000', 365, 10);
      expect(res.discountAmount).toBe('36500000');
      expect(res.netPresentValue).toBe('328500000');
      expect(res.effectivePeriodRatePercent).toBe(10);
    });

    it('computes realistic Iranian commercial banking discount (24% annual, 90 days)', () => {
      const res = calculateSingleDiscount('1000000000', 90, 24);
      expect(res.discountAmount).toBe('59178082');
      expect(res.netPresentValue).toBe('940821918');
      expect(res.effectivePeriodRatePercent).toBe(5.92);
    });

    it('caps discount amount at face value', () => {
      const res = calculateSingleDiscount('1000000', 1000, 100);
      expect(res.discountAmount).toBe('1000000');
      expect(res.netPresentValue).toBe('0');
    });

    it('throws error for negative/excess rate or non-positive amount', () => {
      expect(() => calculateSingleDiscount('1000000', 30, -5)).toThrow('بین ۰ تا ۱۰۰');
      expect(() => calculateSingleDiscount('1000000', 30, 150)).toThrow('بین ۰ تا ۱۰۰');
      expect(() => calculateSingleDiscount('0', 30, 20)).toThrow('بزرگ‌تر از صفر');
    });
  });

  describe('calculateChequesDiscounting (تنزیل پرتفوی چک‌ها)', () => {
    it('computes portfolio discounting and matches sum of individual discounts', () => {
      const baseDate = '2026-11-01';
      const items = [
        { id: 1, amount: '500000000', dueDate: '2026-12-01' },
        { id: 2, amount: '500000000', dueDate: '2026-12-31' },
      ];
      const result = calculateChequesDiscounting(items, 24, baseDate);

      expect(result.totalAmount).toBe('1000000000');
      expect(result.annualRatePercent).toBe(24);
      expect(result.weightedAverageDays).toBe(45);
      expect(result.items[0].discountAmount).toBe('9863014');
      expect(result.items[1].discountAmount).toBe('19726027');
      expect(result.totalDiscountAmount).toBe('29589041');
      expect(result.netPresentValue).toBe('970410959');
    });
  });

  describe('DTO ValidationPipe & AccessGuard wiring', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    it('rejects empty items, invalid dates, bad amounts, and rate > 100 with 400', async () => {
      await expect(pipe.transform({ items: [] }, { type: 'body', metatype: CalculateRasgiriDto })).rejects.toThrow();
      await expect(
        pipe.transform(
          { items: [{ amount: 'abc', dueDate: '2026-12-01' }] },
          { type: 'body', metatype: CalculateRasgiriDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { items: [{ amount: '1000', dueDate: 'not-a-date' }] },
          { type: 'body', metatype: CalculateRasgiriDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { items: [{ amount: '1000', dueDate: '2026-12-01' }], annualRatePercent: 120 },
          { type: 'body', metatype: CalculateDiscountDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { amount: '0', days: 30, annualRatePercent: 24 },
          { type: 'body', metatype: CalculateSingleDiscountDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { chequeIds: [], annualRatePercent: 24 },
          { type: 'body', metatype: CalculateSelectionDiscountDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { chequeIds: [1, 1], annualRatePercent: 24 },
          { type: 'body', metatype: CalculateSelectionDiscountDto },
        ),
      ).rejects.toThrow();
    });

    it('enforces CHEQUES:READ guard on calculator endpoints (allows cheque_reviewer, denies hr)', async () => {
      const access = new AccessStub();
      access.grant('u1', 't1', SystemRole.CHEQUE_REVIEWER);
      access.grant('u2', 't1', SystemRole.HR);
      access.grant('u3', 't1', SystemRole.SALES);
      const guard = new AccessGuard(new Reflector(), access as never);
      const makeCtx = (userId: string, role: SystemRole, handler: Function) =>
        ({
          getClass: () => ChequesController,
          getHandler: () => handler,
          switchToHttp: () => ({
            getRequest: () => ({
              user: { sub: userId, tenantId: 't1', role },
            }),
          }),
        }) as never;

      await expect(
        guard.canActivate(makeCtx('u1', SystemRole.CHEQUE_REVIEWER, ChequesController.prototype.calculateRasgiri)),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeCtx('u2', SystemRole.HR, ChequesController.prototype.calculateRasgiri)),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        guard.canActivate(makeCtx('u3', SystemRole.SALES, ChequesController.prototype.calculateSelectionDiscount)),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
