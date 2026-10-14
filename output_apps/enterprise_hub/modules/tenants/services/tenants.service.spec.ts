import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserEntity } from '../../auth/entities/user.entity';
import { AuthServiceDomain } from '../../auth/enums/auth-service.enum';
import { UserRole } from '../../auth/enums/user-role.enum';
import { TenantRole } from '../enums/tenant-role.enum';
import { TenantsService } from './tenants.service';

const buildUser = (overrides: Partial<UserEntity> = {}): UserEntity =>
  ({
    id: 'user-1',
    phone: '09129367796',
    displayName: null,
    email: null,
    role: UserRole.USER,
    serviceDomain: AuthServiceDomain.ROXIRA,
    tenantId: null,
    tenantRole: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2026-10-14T00:00:00.000Z'),
    updatedAt: new Date('2026-10-14T00:00:00.000Z'),
    ...overrides,
  }) as UserEntity;

interface Mocks {
  tenantsRepository: { findById: jest.Mock; create: jest.Mock };
  authRepository: {
    findByPhone: jest.Mock;
    findOrCreateByPhone: jest.Mock;
    findById: jest.Mock;
    findByTenantId: jest.Mock;
    save: jest.Mock;
  };
}

const createService = () => {
  const mocks: Mocks = {
    tenantsRepository: { findById: jest.fn(), create: jest.fn() },
    authRepository: {
      findByPhone: jest.fn(),
      findOrCreateByPhone: jest.fn(),
      findById: jest.fn(),
      findByTenantId: jest.fn(),
      save: jest.fn(async (user: UserEntity) => user),
    },
  };

  const service = new TenantsService(
    mocks.tenantsRepository as never,
    mocks.authRepository as never,
  );

  return { service, mocks };
};

describe('TenantsService — member management', () => {
  it('lists only the members of the caller tenant', async () => {
    const { service, mocks } = createService();
    const members = [buildUser({ tenantId: 'tenant-1' })];
    mocks.authRepository.findByTenantId.mockResolvedValue(members);

    await expect(service.listMembers('tenant-1')).resolves.toBe(members);
    expect(mocks.authRepository.findByTenantId).toHaveBeenCalledWith('tenant-1');
  });

  it('returns 409 when the phone already belongs to another tenant', async () => {
    const { service, mocks } = createService();
    mocks.authRepository.findByPhone.mockResolvedValue(
      buildUser({ tenantId: 'other-tenant' }),
    );

    await expect(
      service.addMember('tenant-1', {
        phone: '09129367796',
        tenantRole: TenantRole.MEMBER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.authRepository.findOrCreateByPhone).not.toHaveBeenCalled();
  });

  it('assigns tenant_id and tenant_role to a new member', async () => {
    const { service, mocks } = createService();
    mocks.authRepository.findByPhone.mockResolvedValue(null);
    const user = buildUser();
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user,
      created: true,
    });

    const result = await service.addMember('tenant-1', {
      phone: '09129367796',
      tenantRole: TenantRole.MEMBER,
    });

    expect(mocks.authRepository.findOrCreateByPhone).toHaveBeenCalledWith(
      '09129367796',
      AuthServiceDomain.ROXIRA,
    );
    expect(result.tenantId).toBe('tenant-1');
    expect(result.tenantRole).toBe(TenantRole.MEMBER);
    expect(mocks.authRepository.save).toHaveBeenCalledWith(user);
  });

  it('rejects removing a user that belongs to another tenant', async () => {
    const { service, mocks } = createService();
    mocks.authRepository.findById.mockResolvedValue(
      buildUser({ id: 'user-2', tenantId: 'other-tenant' }),
    );

    await expect(
      service.removeMember('tenant-1', 'user-2', 'owner-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.authRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an owner removing themself', async () => {
    const { service, mocks } = createService();
    mocks.authRepository.findById.mockResolvedValue(
      buildUser({
        id: 'owner-1',
        tenantId: 'tenant-1',
        tenantRole: TenantRole.OWNER,
      }),
    );

    await expect(
      service.removeMember('tenant-1', 'owner-1', 'owner-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.authRepository.save).not.toHaveBeenCalled();
  });

  it('nulls tenant_id and tenant_role when removing a valid member', async () => {
    const { service, mocks } = createService();
    const user = buildUser({
      id: 'user-2',
      tenantId: 'tenant-1',
      tenantRole: TenantRole.MEMBER,
    });
    mocks.authRepository.findById.mockResolvedValue(user);

    await service.removeMember('tenant-1', 'user-2', 'owner-1');

    expect(user.tenantId).toBeNull();
    expect(user.tenantRole).toBeNull();
    expect(mocks.authRepository.save).toHaveBeenCalledWith(user);
  });

  it('resolves the current tenant from the JWT tenant id', async () => {
    const { service, mocks } = createService();
    const tenant = { id: 'tenant-1', name: 'Acme', slug: 'acme-1' };
    mocks.tenantsRepository.findById.mockResolvedValue(tenant);

    await expect(service.findMyTenant('tenant-1')).resolves.toBe(tenant);
  });
});
