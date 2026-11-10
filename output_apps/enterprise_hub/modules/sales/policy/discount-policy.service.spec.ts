import { BadRequestException } from '@nestjs/common';
import { SystemRole } from '../../access/catalogue';
import { DiscountPolicyService } from './discount-policy.service';

describe('DiscountPolicyService', () => {
  let service: DiscountPolicyService;
  let mockPolicyService: any;

  beforeEach(() => {
    mockPolicyService = {
      get: jest.fn(),
    };
    service = new DiscountPolicyService(mockPolicyService);
  });

  it('allows any discount when enforcement is off', async () => {
    mockPolicyService.get.mockResolvedValueOnce('off');

    const result = await service.checkDiscount('tenant-1', 'sales_agent', [
      { discountPercent: 50 },
    ]);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('allows owner or admin to grant up to 100% discount', async () => {
    mockPolicyService.get.mockResolvedValueOnce('refuse');

    const result = await service.checkDiscount('tenant-1', 'owner', [
      { discountPercent: 75 },
    ]);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
  });

  it('enforces agent limit (default 10%) and refuses exceeding discount', async () => {
    mockPolicyService.get
      .mockResolvedValueOnce('refuse') // enforcement
      .mockResolvedValueOnce(10); // agent limit

    await expect(
      service.checkDiscount('tenant-1', 'sales_agent', [{ discountPercent: 15 }]),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows agent discount within limit', async () => {
    mockPolicyService.get
      .mockResolvedValueOnce('refuse') // enforcement
      .mockResolvedValueOnce(10); // agent limit

    const result = await service.checkDiscount('tenant-1', 'sales_agent', [
      { discountPercent: 8 },
    ]);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.maxDiscount).toBe(8);
  });

  it('returns warning when enforcement is warn and discount exceeds limit', async () => {
    mockPolicyService.get
      .mockResolvedValueOnce('warn') // enforcement
      .mockResolvedValueOnce(25); // manager limit

    const result = await service.checkDiscount('tenant-1', 'sales_manager', [
      { discountPercent: 30 },
    ]);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('تخفیف');
    expect(result.maxDiscount).toBe(30);
    expect(result.limit).toBe(25);
  });

  it('calculates percent from discountAmountMinor and grossAmountMinor when percent not provided', async () => {
    mockPolicyService.get
      .mockResolvedValueOnce('refuse')
      .mockResolvedValueOnce(10);

    // discount 200,000 on 1,000,000 = 20% > 10%
    await expect(
      service.checkDiscount('tenant-1', 'sales_agent', [
        {
          discountAmountMinor: 20000000n,
          grossAmountMinor: 100000000n,
        },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  describe('SystemRole mapping', () => {
    it('maps SystemRole.OWNER and SystemRole.ADMIN to 100%', async () => {
      mockPolicyService.get.mockResolvedValue('refuse');
      const ownerRes = await service.checkDiscount('tenant-1', SystemRole.OWNER, [{ discountPercent: 90 }]);
      expect(ownerRes.allowed).toBe(true);
      expect(ownerRes.limit).toBe(100);

      const adminRes = await service.checkDiscount('tenant-1', SystemRole.ADMIN, [{ discountPercent: 90 }]);
      expect(adminRes.allowed).toBe(true);
      expect(adminRes.limit).toBe(100);
    });

    it('maps SystemRole.ACCOUNTANT to manager discount limit (default 25%)', async () => {
      mockPolicyService.get
        .mockResolvedValueOnce('refuse') // enforcement
        .mockResolvedValueOnce(25); // manager limit

      const res = await service.checkDiscount('tenant-1', SystemRole.ACCOUNTANT, [{ discountPercent: 20 }]);
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(25);
    });

    it('maps SystemRole.SALES to agent discount limit (default 10%)', async () => {
      mockPolicyService.get
        .mockResolvedValueOnce('refuse') // enforcement
        .mockResolvedValueOnce(10); // agent limit

      const res = await service.checkDiscount('tenant-1', SystemRole.SALES, [{ discountPercent: 5 }]);
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(10);
    });

    it('fails closed (0% limit) for non-sales roles like read_only, hr or empty role', async () => {
      mockPolicyService.get.mockResolvedValue('refuse');

      await expect(
        service.checkDiscount('tenant-1', SystemRole.READ_ONLY, [{ discountPercent: 1 }]),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.checkDiscount('tenant-1', SystemRole.HR, [{ discountPercent: 1 }]),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.checkDiscount('tenant-1', '', [{ discountPercent: 1 }]),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
