import { BadRequestException } from '@nestjs/common';
import { BudgetControlService } from './budget-control.service';

describe('BudgetControlService', () => {
  let service: BudgetControlService;
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
    service = new BudgetControlService(mockScope, mockPolicyService);
  });

  it('allows expense when policy mode is off', async () => {
    mockPolicyService.get.mockResolvedValueOnce('off');

    const result = await service.checkBudget('tenant-1', {
      projectCode: 'PRJ-1',
      amountMinor: 50000000n,
    });

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('allows expense when project has 0 budget', async () => {
    mockPolicyService.get.mockResolvedValueOnce('warn');
    // budget = 0
    mockManager.query.mockResolvedValueOnce([{ budget: '0.00' }]);

    const result = await service.checkBudget('tenant-1', {
      projectCode: 'PRJ-1',
      amountMinor: 50000000n,
    });

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('returns warning when mode is warn and spend + newAmount > budget', async () => {
    mockPolicyService.get.mockResolvedValueOnce('warn');
    // budget: 1,000,000 Rial = 100,000,000 minor
    mockManager.query
      .mockResolvedValueOnce([{ budget: '1000000.00' }])
      // actual spend: 800,000 Rial = 80,000,000 minor
      .mockResolvedValueOnce([{ spend: '800000.00' }]);

    // new amount: 300,000 Rial (30,000,000 minor) -> 1,100,000 > 1,000,000
    const result = await service.checkBudget('tenant-1', {
      projectCode: 'PRJ-1',
      amountMinor: 30000000n,
    });

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('سقف بودجه');
    expect(result.budgetMinor).toBe(100000000n);
    expect(result.actualSpendMinor).toBe(80000000n);
  });

  it('throws BadRequestException when mode is refuse and budget exceeded', async () => {
    mockPolicyService.get.mockResolvedValueOnce('refuse');
    // budget: 500,000 Rial = 50,000,000 minor
    mockManager.query
      .mockResolvedValueOnce([{ budget: '500000.00' }])
      // actual spend: 400,000 Rial
      .mockResolvedValueOnce([{ spend: '400000.00' }]);

    // new amount: 200,000 Rial -> 600,000 > 500,000
    await expect(
      service.checkBudget('tenant-1', {
        projectCode: 'PRJ-1',
        amountMinor: 20000000n,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows expense within budget', async () => {
    mockPolicyService.get.mockResolvedValueOnce('refuse');
    mockManager.query
      .mockResolvedValueOnce([{ budget: '1000000.00' }])
      .mockResolvedValueOnce([{ spend: '500000.00' }]);

    const result = await service.checkBudget('tenant-1', {
      projectCode: 'PRJ-1',
      amountMinor: 30000000n,
    });

    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});
