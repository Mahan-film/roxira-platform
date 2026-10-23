import 'reflect-metadata';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import {
  OTP_GENERIC_ERROR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_LIMIT_ERROR,
  OTP_SEND_LIMIT_REDIS_PREFIX,
} from '../constants/auth.constants';
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

/** Minimal in-memory stand-in for the ioredis calls AuthService makes. */
class FakeRedis {
  readonly store = new Map<string, string>();

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);

  /** key -> TTL seconds; -1 = exists without TTL (what a crash would leave). */
  readonly ttls = new Map<string, number>();

  set = jest.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    const exIdx = args.indexOf('EX');
    this.ttls.set(key, exIdx >= 0 ? Number(args[exIdx + 1]) : -1);
    return 'OK';
  });

  del = jest.fn(async (...keys: string[]) =>
    keys.reduce((n, key) => {
      this.ttls.delete(key);
      return n + (this.store.delete(key) ? 1 : 0);
    }, 0),
  );

  incr = jest.fn(async (key: string) => {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  });

  expire = jest.fn(async (key: string, seconds: number) => {
    this.ttls.set(key, seconds);
    return 1;
  });

  ttl = jest.fn(async (key: string) =>
    this.store.has(key) ? (this.ttls.get(key) ?? -1) : -2,
  );

  /** Emulates the atomic INCR+EXPIRE Lua script (single call, no gap). */
  eval = jest.fn(
    async (_script: string, _n: number, key: string, window: number) => {
      const next = await this.incr(key);
      if (next === 1 || (this.ttls.get(key) ?? -1) < 0) {
        this.ttls.set(key, Number(window));
      }
      return next;
    },
  );
}

interface Mocks {
  authRepository: { findOrCreateByPhone: jest.Mock; save: jest.Mock };
  tenantsService: { create: jest.Mock };
  jwtService: { signAsync: jest.Mock };
  config: { get: jest.Mock; getOrThrow: jest.Mock };
  kavenegar: { sendVerificationCode: jest.Mock; templateFor: jest.Mock };
  redis: FakeRedis;
}

const PHONE = '09121234567';

const createService = () => {
  const mocks: Mocks = {
    authRepository: {
      findOrCreateByPhone: jest.fn(),
      save: jest.fn(async (user: UserEntity) => user),
    },
    tenantsService: { create: jest.fn() },
    jwtService: { signAsync: jest.fn().mockResolvedValue('jwt-token') },
    config: {
      get: jest.fn().mockReturnValue(''),
      getOrThrow: jest.fn().mockReturnValue('test-only-not-a-real-secret'),
    },
    kavenegar: {
      sendVerificationCode: jest.fn().mockResolvedValue(true),
      templateFor: jest.fn().mockReturnValue('roxira-verify'),
    },
    redis: new FakeRedis(),
  };

  const service = new AuthService(
    mocks.authRepository as never,
    mocks.kavenegar as never,
    mocks.jwtService as never,
    mocks.config as never,
    mocks.tenantsService as never,
    mocks.redis as never,
  );

  return { service, mocks };
};

/** Issue a real code through sendOtp and return what the SMS gateway received. */
const issueCode = async (
  service: AuthService,
  mocks: Mocks,
  phone = PHONE,
): Promise<string> => {
  await service.sendOtp({ phone });
  const calls = mocks.kavenegar.sendVerificationCode.mock.calls;
  return calls[calls.length - 1][1] as string;
};

const wrongCode = (code: string): string =>
  String((Number(code) + 1) % 1_000_000).padStart(6, '0');

const issuedPayload = (mocks: Mocks) =>
  mocks.jwtService.signAsync.mock.calls[0][0] as {
    tenantId: string | null;
    tenantRole: string | null;
    role: string;
  };

describe('AuthService.verifyOtp — organisation onboarding', () => {
  it('creates an organisation and makes the founder tenant OWNER (never global ADMIN)', async () => {
    const { service, mocks } = createService();
    const code = await issueCode(service, mocks);
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
      phone: PHONE,
      code,
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
    const code = await issueCode(service, mocks);
    const user = buildUser({
      tenantId: 'existing-tenant',
      tenantRole: TenantRole.OWNER,
    });
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user,
      created: false,
    });

    await service.verifyOtp({
      phone: PHONE,
      code,
      organizationName: 'Other Org',
    });

    expect(mocks.tenantsService.create).not.toHaveBeenCalled();
    expect(mocks.authRepository.save).not.toHaveBeenCalled();
    expect(user.tenantId).toBe('existing-tenant');
    expect(issuedPayload(mocks).tenantId).toBe('existing-tenant');
  });

  it('issues null tenant claims when no organisation is requested', async () => {
    const { service, mocks } = createService();
    const code = await issueCode(service, mocks);
    const user = buildUser();
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user,
      created: true,
    });

    await service.verifyOtp({ phone: PHONE, code });

    expect(mocks.tenantsService.create).not.toHaveBeenCalled();
    const payload = issuedPayload(mocks);
    expect(payload.tenantId).toBeNull();
    expect(payload.tenantRole).toBeNull();
  });
});

describe('AuthService OTP hardening (issue #366)', () => {
  const login = (mocks: Mocks) =>
    mocks.authRepository.findOrCreateByPhone.mockResolvedValue({
      user: buildUser(),
      created: false,
    });

  const expectGeneric = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(promise).rejects.toThrow(OTP_GENERIC_ERROR);
  };

  it('issues 6-digit codes and never returns or stores them in clear', async () => {
    const { service, mocks } = createService();
    for (let i = 0; i < 3; i += 1) {
      mocks.redis.store.clear();
      const response = await service.sendOtp({ phone: PHONE });
      const code = mocks.kavenegar.sendVerificationCode.mock.calls[i][1];
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(response)).not.toContain(code);
      const stored = [...mocks.redis.store.values()].join(' ');
      expect(stored).not.toContain(code);
      expect(stored).toMatch(/"hash":"[0-9a-f]{64}"/);
    }
  });

  it('never writes the code or the full phone to the logs', async () => {
    const { service, mocks } = createService();
    const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
    const code = await issueCode(service, mocks);
    login(mocks);
    await service.verifyOtp({ phone: PHONE, code });
    const logged = logSpy.mock.calls.map((args) => String(args[0])).join(' ');
    expect(logged).not.toContain(code);
    expect(logged).not.toContain(PHONE);
  });

  it('accepts the right code once (single use)', async () => {
    const { service, mocks } = createService();
    login(mocks);
    const code = await issueCode(service, mocks);
    await expect(
      service.verifyOtp({ phone: PHONE, code }),
    ).resolves.toMatchObject({ accessToken: 'jwt-token' });
    await expectGeneric(service.verifyOtp({ phone: PHONE, code }));
  });

  it('still accepts the right code after 4 wrong ones', async () => {
    const { service, mocks } = createService();
    login(mocks);
    const code = await issueCode(service, mocks);
    for (let i = 0; i < 4; i += 1) {
      await expectGeneric(
        service.verifyOtp({ phone: PHONE, code: wrongCode(code) }),
      );
    }
    await expect(
      service.verifyOtp({ phone: PHONE, code }),
    ).resolves.toBeDefined();
  });

  it('invalidates the code after 5 wrong attempts', async () => {
    const { service, mocks } = createService();
    login(mocks);
    const code = await issueCode(service, mocks);
    for (let i = 0; i < 5; i += 1) {
      await expectGeneric(
        service.verifyOtp({ phone: PHONE, code: wrongCode(code) }),
      );
    }
    await expectGeneric(service.verifyOtp({ phone: PHONE, code }));
    expect(mocks.authRepository.findOrCreateByPhone).not.toHaveBeenCalled();
  });

  it('gives the same error for an unknown phone and a wrong code', async () => {
    const { service, mocks } = createService();
    await expectGeneric(
      service.verifyOtp({ phone: '09120000000', code: '123456' }),
    );
    const code = await issueCode(service, mocks);
    await expectGeneric(
      service.verifyOtp({ phone: PHONE, code: wrongCode(code) }),
    );
  });

  /** Skip the resend cooldown so a test can hit the per-phone cap quickly. */
  const clearCooldown = (mocks: Mocks, phone = PHONE) =>
    mocks.redis.store.delete(`${OTP_SEND_LIMIT_REDIS_PREFIX}cd:${phone}`);

  it('limits successful sends per phone (3 per 10 minutes) with a generic 429', async () => {
    const { service, mocks } = createService();
    for (let i = 0; i < 3; i += 1) {
      clearCooldown(mocks);
      await service.sendOtp({ phone: PHONE }, undefined, '198.51.100.1');
    }
    clearCooldown(mocks);
    const blocked = service.sendOtp({ phone: PHONE }, undefined, '198.51.100.1');
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await expect(blocked).rejects.toThrow(OTP_SEND_LIMIT_ERROR);
    expect(mocks.kavenegar.sendVerificationCode).toHaveBeenCalledTimes(3);
    expect(mocks.redis.ttls.get(`${OTP_SEND_LIMIT_REDIS_PREFIX}phone:${PHONE}`)).toBe(600);
  });

  it('enforces a 60 s resend cooldown, then allows the next send', async () => {
    const { service, mocks } = createService();
    await service.sendOtp({ phone: PHONE }, undefined, '198.51.100.1');
    await expect(
      service.sendOtp({ phone: PHONE }, undefined, '198.51.100.1'),
    ).rejects.toThrow(OTP_SEND_LIMIT_ERROR);
    expect(mocks.kavenegar.sendVerificationCode).toHaveBeenCalledTimes(1);
    // cooldown key carries a 60 s TTL; once it expires the resend works
    expect(mocks.redis.ttls.get(`${OTP_SEND_LIMIT_REDIS_PREFIX}cd:${PHONE}`)).toBe(
      OTP_RESEND_COOLDOWN_SECONDS,
    );
    clearCooldown(mocks);
    await expect(
      service.sendOtp({ phone: PHONE }, undefined, '198.51.100.1'),
    ).resolves.toMatchObject({ success: true });
  });

  it('does not count failed SMS sends or blocked attempts against the phone', async () => {
    const { service, mocks } = createService();
    mocks.kavenegar.sendVerificationCode.mockResolvedValue(false);
    for (let i = 0; i < 5; i += 1) {
      await service.sendOtp({ phone: PHONE }, undefined, `198.51.100.${i}`);
    }
    // failed sends neither count nor hold the cooldown
    expect(mocks.redis.store.get(`${OTP_SEND_LIMIT_REDIS_PREFIX}phone:${PHONE}`)).toBeUndefined();
    mocks.kavenegar.sendVerificationCode.mockResolvedValue(true);
    await service.sendOtp({ phone: PHONE }, undefined, '198.51.100.50');
    // blocked-by-cooldown attempts must not bump the phone counter
    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.sendOtp({ phone: PHONE }, undefined, `198.51.100.${60 + i}`),
      ).rejects.toThrow(OTP_SEND_LIMIT_ERROR);
    }
    expect(mocks.redis.store.get(`${OTP_SEND_LIMIT_REDIS_PREFIX}phone:${PHONE}`)).toBe('1');
  });

  it('self-heals a counter key that lost its TTL (no permanent lockout)', async () => {
    const { service, mocks } = createService();
    const ipKey = `${OTP_SEND_LIMIT_REDIS_PREFIX}ip:198.51.100.9`;
    mocks.redis.store.set(ipKey, '50'); // crash left INCR without EXPIRE
    await expect(
      service.sendOtp({ phone: PHONE }, undefined, '198.51.100.9'),
    ).rejects.toThrow(OTP_SEND_LIMIT_ERROR);
    expect(mocks.redis.ttls.get(ipKey)).toBe(3600);

    const phoneKey = `${OTP_SEND_LIMIT_REDIS_PREFIX}phone:${PHONE}`;
    mocks.redis.store.set(phoneKey, '3');
    await expect(
      service.sendOtp({ phone: PHONE }, undefined, '198.51.100.10'),
    ).rejects.toThrow(OTP_SEND_LIMIT_ERROR);
    expect(mocks.redis.ttls.get(phoneKey)).toBe(600);
  });

  it('counts with a single atomic eval (no separate INCR/EXPIRE round trips)', async () => {
    const { service, mocks } = createService();
    await service.sendOtp({ phone: PHONE }, undefined, '198.51.100.1');
    expect(mocks.redis.eval).toHaveBeenCalled();
    expect(mocks.redis.incr).toHaveBeenCalledTimes(mocks.redis.eval.mock.calls.length);
    expect(String(mocks.redis.eval.mock.calls[0][0])).toContain("'EXPIRE'");
  });

  it('limits sends per source IP (10 per hour)', async () => {
    const { service, mocks } = createService();
    const ip = '198.51.100.7';
    for (let i = 0; i < 10; i += 1) {
      const phone = `0912000${String(i).padStart(4, '0')}`;
      await service.sendOtp({ phone }, undefined, ip);
    }
    await expect(
      service.sendOtp({ phone: '09129999999' }, undefined, ip),
    ).rejects.toThrow(OTP_SEND_LIMIT_ERROR);
    await expect(
      service.sendOtp({ phone: '09129999999' }, undefined, '198.51.100.8'),
    ).resolves.toMatchObject({ success: true });
    expect(mocks.kavenegar.sendVerificationCode).toHaveBeenCalledTimes(11);
  });
});
