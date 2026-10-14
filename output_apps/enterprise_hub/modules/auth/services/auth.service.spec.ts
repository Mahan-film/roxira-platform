import 'reflect-metadata';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { UserRole } from '../enums/user-role.enum';
import { UserEntity } from '../entities/user.entity';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { AuthService } from './auth.service';

const buildUser = (overrides: Partial<UserEntity> = {}): UserEntity =>
  ({
    id: 'user-1',
    phone: '09121234567',
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
  authRepository: { findOrCreateByPhone: jest.Mock; save: jest.Mock };
  tenantsService: { create: jest.Mock };
  jwtService: { signAsync: jest.Mock };
  config: { get: jest.Mock };
  redis: { get: jest.Mock; del: jest.Mock; set: jest.Mock };
}

const createService = () => {
  const mocks: Mocks = {
    authRepository: {
      findOrCreateByPhone: jest.fn(),
      save: jest.fn(async (user: UserEntity) => user),
    },
    tenantsService: { create: jest.fn() },
    jwtService: { signAsync: jest.fn().mockResolvedValue('jwt-token') },
    config: { get: jest.fn().mockReturnValue('') },
    redis: {
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    },
  };

  const service = new AuthService(
    mocks.authRepository as never,
    {} as never,
    mocks.jwtService as never,
    mocks.config as never,
    mocks.tenantsService as never,
    mocks.redis as never,
  );

  return { service, mocks };
};

const seedValidOtp = (redis: Mocks['redis']): void => {
  redis.get.mockResolvedValue(
    JSON.stringify({
      code: '48321',
      attempts: 0,
      domain: AuthServiceDomain.ROXIRA,
      issuedAt: Date.now(),
    }),
  );
};

const issuedPayload = (mocks: Mocks) =>
  mocks.jwtService.signAsync.mock.calls[0][0] as {
    tenantId: string | null;
    tenantRole: string | null;
    role: string;
  };

describe('AuthService.verifyOtp — organisation onboarding', () => {
  it('creates an organisation and makes the founder tenant OWNER (never global ADMIN)', async () => {
    const { service, mocks } = createService();
    seedValidOtp(mocks.redis);
    const user = buildUser();
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user,
      created: true,
    });
    mocks.tenantsService.create.mockResolvedValue({
      id: 'tenant-1',
      name: 'Acme',
      slug: 'acme-abc123',
    });

    await service.verifyOtp({
      phone: '09121234567',
      code: '48321',
      organizationName: 'Acme',
    });

    expect(mocks.tenantsService.create).toHaveBeenCalledWith('Acme');
    expect(mocks.authRepository.save).toHaveBeenCalledWith(user);
    expect(user.tenantId).toBe('tenant-1');
    expect(user.tenantRole).toBe(TenantRole.OWNER);
    expect(user.role).not.toBe(UserRole.ADMIN);

    const payload = issuedPayload(mocks);
    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.tenantRole).toBe('OWNER');
  });

  it('ignores organizationName when the user already belongs to a tenant', async () => {
    const { service, mocks } = createService();
    seedValidOtp(mocks.redis);
    const user = buildUser({
      tenantId: 'existing-tenant',
      tenantRole: TenantRole.OWNER,
    });
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user,
      created: false,
    });

    await service.verifyOtp({
      phone: '09121234567',
      code: '48321',
      organizationName: 'Other Org',
    });

    expect(mocks.tenantsService.create).not.toHaveBeenCalled();
    expect(mocks.authRepository.save).not.toHaveBeenCalled();
    expect(user.tenantId).toBe('existing-tenant');
    expect(issuedPayload(mocks).tenantId).toBe('existing-tenant');
  });

  it('issues null tenant claims when no organisation is requested', async () => {
    const { service, mocks } = createService();
    seedValidOtp(mocks.redis);
    const user = buildUser();
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user,
      created: true,
    });

    await service.verifyOtp({ phone: '09121234567', code: '48321' });

    expect(mocks.tenantsService.create).not.toHaveBeenCalled();
    const payload = issuedPayload(mocks);
    expect(payload.tenantId).toBeNull();
    expect(payload.tenantRole).toBeNull();
  });
});
