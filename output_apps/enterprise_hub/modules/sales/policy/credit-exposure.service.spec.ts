import { BadRequestException } from '@nestjs/common';
import { CreditExposureService } from './credit-exposure.service';

describe('CreditExposureService', () => {
  let service: CreditExposureService;
  let mockScope: any;
  let mockPolicyService: any;
  let mockManager: any;

  beforeEach(() => {
    mockManager = {
      query: jest.fn(),
    };
    mockScope = {
      within: jest.fn((tenantId, manager, callback) => callback(mockManager)),
    };
    mockPolicyService = {
      get: jest.fn(),
    };
    service = new CreditExposureService(mockScope, mockPolicyService);
  });

  describe('computeExposure', () => {
    it('sums open sale invoices and uncleared received cheques correctly', async () => {
      mockManager.query
        // 1. Invoices
        .mockResolvedValueOnce([{ total: '1500000.00' }])
        // 2. Cheques
        .mockResolvedValueOnce([{ total: '500000.00' }]);

      const result = await service.computeExposure('tenant-1', 'C-100');

      expect(result.openInvoices).toBe(150000000n);
      expect(result.unclearedCheques).toBe(50000000n);
      expect(result.totalExposure).toBe(200000000n);
    });
  });

  describe('checkCreditExposure', () => {
    it('returns allowed when policy mode is off', async () => {
      mockPolicyService.get.mockResolvedValue('off');

      const result = await service.checkCreditExposure('tenant-1', 'C-100', 50000n);

      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('returns allowed when party has no limit and default policy limit is 0', async () => {
      mockPolicyService.get
        .mockResolvedValueOnce('warn') // mode
        .mockResolvedValueOnce(0); // default limit

      mockManager.query.mockResolvedValueOnce([{ credit_limit: '0' }]);

      const result = await service.checkCreditExposure('tenant-1', 'C-100', 50000n);

      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('returns warning when mode is warn and total exposure exceeds limit', async () => {
      mockPolicyService.get.mockResolvedValueOnce('warn');

      // party limit: 10,000,000 Rial = 1,000,000,000 minor
      mockManager.query
        .mockResolvedValueOnce([{ credit_limit: '1000000000' }])
        // open invoices
        .mockResolvedValueOnce([{ total: '8000000.00' }])
        // uncleared cheques
        .mockResolvedValueOnce([{ total: '1500000.00' }]);

      // current exposure: 9,500,000 Rial. New amount: 1,000,000 Rial (100,000,000 minor) -> 10,500,000 > 10,000,000
      const result = await service.checkCreditExposure('tenant-1', 'C-100', 100000000n);

      expect(result.allowed).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('سقف اعتبار');
      expect(result.exposure).toBe(950000000n);
      expect(result.limit).toBe(1000000000n);
    });

    it('throws BadRequestException when mode is refuse and exposure exceeds limit', async () => {
      mockPolicyService.get.mockResolvedValueOnce('refuse');

      // party limit: 5,000,000 Rial = 500,000,000 minor
      mockManager.query
        .mockResolvedValueOnce([{ credit_limit: '500000000' }])
        // open invoices: 4,000,000
        .mockResolvedValueOnce([{ total: '4000000.00' }])
        // cheques: 1,000,000
        .mockResolvedValueOnce([{ total: '1000000.00' }]);

      // current exposure: 5,000,000 Rial. New: 1,000,000 Rial -> 6,000,000 > 5,000,000
      await expect(
        service.checkCreditExposure('tenant-1', 'C-100', 100000000n),
      ).rejects.toThrow(BadRequestException);
    });

    it('falls back to default policy limit if party limit is 0', async () => {
      mockPolicyService.get
        .mockResolvedValueOnce('refuse') // mode
        .mockResolvedValueOnce(5000000); // default limit: 5,000,000 Rial

      // party limit = 0
      mockManager.query
        .mockResolvedValueOnce([{ credit_limit: '0' }])
        // open invoices
        .mockResolvedValueOnce([{ total: '4500000.00' }])
        // cheques
        .mockResolvedValueOnce([{ total: '1000000.00' }]);

      // total 5,500,000 > 5,000,000
      await expect(
        service.checkCreditExposure('tenant-1', 'C-100', 100000000n),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
