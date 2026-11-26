import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantRole } from '../enums/tenant-role.enum';

describe('TenantsController', () => {
  let controller: TenantsController;
  let tenantsService: any;
  let cancellationService: any;

  beforeEach(() => {
    tenantsService = {
      findMyTenant: jest.fn(),
      updateSettings: jest.fn(),
    };
    cancellationService = {
      cancelTenant: jest.fn(),
      getCancellationStatus: jest.fn(),
    };
    controller = new TenantsController(tenantsService, cancellationService);
  });

  describe('me', () => {
    it('returns tenant details for current user', async () => {
      const mockTenant = { id: 't1', name: 'Roxira', slug: 'roxira' };
      tenantsService.findMyTenant.mockResolvedValue(mockTenant);

      const req: any = { user: { tenantId: 't1', tenantRole: TenantRole.OWNER } };
      const res = await controller.me(req);

      expect(res.id).toBe('t1');
      expect(res.tenantRole).toBe(TenantRole.OWNER);
    });

    it('throws ForbiddenException if tenant not found', async () => {
      tenantsService.findMyTenant.mockResolvedValue(null);
      const req: any = { user: { tenantId: 't1' } };

      await expect(controller.me(req)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelTenant', () => {
    it('calls cancellationService.cancelTenant and returns response', async () => {
      const expected = {
        status: 'cancelled_readonly',
        isReadonly: true,
        cancelledAt: new Date().toISOString(),
        deleteAfter: new Date(Date.now() + 30 * 86400000).toISOString(),
        daysRemaining: 30,
        cancellationReason: 'Going out of business',
      };
      cancellationService.cancelTenant.mockResolvedValue(expected);

      const req: any = { user: { tenantId: 't1' } };
      const dto = { reason: 'Going out of business', gracePeriodDays: 30 };

      const res = await controller.cancelTenant(req, dto);

      expect(cancellationService.cancelTenant).toHaveBeenCalledWith('t1', 'Going out of business', 30);
      expect(res).toEqual(expected);
    });
  });

  describe('getCancellationStatus', () => {
    it('calls cancellationService.getCancellationStatus and returns status', async () => {
      const expected = {
        status: 'active',
        isReadonly: false,
        cancelledAt: null,
        deleteAfter: null,
        daysRemaining: null,
        cancellationReason: null,
      };
      cancellationService.getCancellationStatus.mockResolvedValue(expected);

      const req: any = { user: { tenantId: 't1' } };
      const res = await controller.getCancellationStatus(req);

      expect(cancellationService.getCancellationStatus).toHaveBeenCalledWith('t1');
      expect(res).toEqual(expected);
    });
  });
});
