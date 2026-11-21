import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CancelledReadonlyGuard } from './cancelled-readonly.guard';
import { TenantStatus } from '../enums/tenant-status.enum';
import { TenantsRepository } from '../repositories/tenants.repository';

describe('CancelledReadonlyGuard', () => {
  let guard: CancelledReadonlyGuard;
  let reflector: Reflector;
  let mockTenantsRepo: Partial<TenantsRepository>;

  const TENANT_ID = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    reflector = new Reflector();
    mockTenantsRepo = {
      findById: jest.fn(),
    };
    guard = new CancelledReadonlyGuard(reflector, mockTenantsRepo as TenantsRepository);
  });

  const createContext = (method: string, user?: { tenantId?: string }, allowCancellation = false): ExecutionContext => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === 'allow_during_cancellation') return allowCancellation;
      if (key === 'isPublic') return false;
      return undefined;
    });

    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          user: user ?? { tenantId: TENANT_ID },
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('allows mutating requests for ACTIVE tenants', async () => {
    (mockTenantsRepo.findById as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: TenantStatus.ACTIVE,
    });

    const ctx = createContext('POST');
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
  });

  it('allows safe read requests (GET) for CANCELLED_READONLY tenants', async () => {
    (mockTenantsRepo.findById as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: TenantStatus.CANCELLED_READONLY,
      deleteAfter: new Date('2026-12-31'),
    });

    const ctx = createContext('GET');
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
  });

  it('blocks mutating write requests (POST, PUT, DELETE) for CANCELLED_READONLY tenants', async () => {
    (mockTenantsRepo.findById as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: TenantStatus.CANCELLED_READONLY,
      deleteAfter: new Date('2026-12-31'),
    });

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const ctx = createContext(method);
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    }
  });

  it('allows mutating requests for CANCELLED_READONLY tenants if decorated with @AllowDuringCancellation', async () => {
    (mockTenantsRepo.findById as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: TenantStatus.CANCELLED_READONLY,
      deleteAfter: new Date('2026-12-31'),
    });

    const ctx = createContext('POST', { tenantId: TENANT_ID }, true);
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
  });

  it('blocks all requests for PURGED tenants', async () => {
    (mockTenantsRepo.findById as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: TenantStatus.PURGED,
    });

    const ctx = createContext('GET');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
