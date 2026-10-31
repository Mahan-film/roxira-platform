import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FakeRedis } from '../../../test/support/fake-redis';
import {
  InMemoryAuthRepository,
  InMemoryRefreshTokenRepository,
} from '../../../test/support/in-memory-auth';
import {
  FORGOT_GENERIC_RESPONSE,
  LOGIN_GENERIC_ERROR,
  LOGIN_RATE_LIMIT_ERROR,
  RESET_INVALID_ERROR,
  SIGNUP_UNAVAILABLE_ERROR,
} from '../constants/password-auth.constants';
import { SignupDto } from '../dto/password-auth.dto';
import { UserEntity } from '../entities/user.entity';
import { PasswordAuthService } from './password-auth.service';
import { RefreshTokenService } from './refresh-token.service';

const PW = 'a-long-unusual-pass';
const IP = '198.51.100.1';

const setup = () => {
  const repo = new InMemoryAuthRepository();
  const redis = new FakeRedis();
  const refreshRepo = new InMemoryRefreshTokenRepository();
  const refresh = new RefreshTokenService(refreshRepo as never);
  const tenants = { create: jest.fn(async (_userId: string, name: string) => ({ tenantId: `tenant-${name.length}` })) };
  const invitations = { accept: jest.fn(async () => ({ tenantId: 'org-9' })) };
  const audit = { record: jest.fn(async () => undefined) };
  const mail = {
    sendPasswordReset: jest.fn(
      async (_to: string, _token: string, _locale: string, _ttl: number) => true,
    ),
  };
  const session = async (user: UserEntity) => ({
    accessToken: 'jwt',
    refreshToken: (await refresh.issue(user)).token,
    user,
  });
  const authService = {
    completeLogin: jest.fn(async (user: UserEntity, _ctx?: unknown) => session(user)),
    issueSessionForUser: jest.fn(async (user: UserEntity, _opts?: unknown) => session(user)),
  };
  const service = new PasswordAuthService(
    repo as never,
    authService as never,
    tenants as never,
    invitations as never,
    audit as never,
    refresh as never,
    mail as never,
    redis as never,
  );
  return { service, repo, redis, tenants, mail, refreshRepo, authService, invitations, audit };
};

const signup = (service: PasswordAuthService, over: Partial<SignupDto> = {}, ip = IP) =>
  service.signup({ email: 'jane@example.com', password: PW, ...over } as SignupDto, ip);

describe('PasswordAuthService.signup', () => {
  it('creates the user with a hashed password and a session, and no organisation by default', async () => {
    const { service, repo, tenants, authService } = setup();
    await signup(service, { username: 'jane' });
    const user = [...repo.users.values()][0];
    expect(user).toMatchObject({ phone: null, username: 'jane', loginEmail: 'jane@example.com' });
    expect(user.tenantId).toBeNull();
    expect(tenants.create).not.toHaveBeenCalled();
    expect(authService.completeLogin).toHaveBeenCalledWith(user, expect.objectContaining({ ip: IP }));
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain(PW);
  });

  it('creates an organisation owned by the user only when a name is given', async () => {
    const { service, repo, tenants, authService } = setup();
    await signup(service, { organizationName: 'Acme Ltd' });
    const user = [...repo.users.values()][0];
    expect(tenants.create).toHaveBeenCalledWith(user.id, 'Acme Ltd');
    expect(authService.completeLogin).toHaveBeenCalledWith(user, expect.objectContaining({ tenantId: 'tenant-8' }));
  });

  it('joins by invitation and never asks for (or creates) an organisation', async () => {
    const { service, repo, tenants, invitations, authService } = setup();
    await signup(service, { inviteToken: 'i'.repeat(43), organizationName: 'ignored' });
    const user = [...repo.users.values()][0];
    expect(invitations.accept).toHaveBeenCalledWith(user.id, 'i'.repeat(43));
    expect(tenants.create).not.toHaveBeenCalled();
    expect(authService.completeLogin).toHaveBeenCalledWith(user, expect.objectContaining({ tenantId: 'org-9' }));
  });

  it('normalises case and rejects a second signup with the same email or username (generic 409)', async () => {
    const { service } = setup();
    await signup(service, { email: 'Jane@Example.com', username: 'jane' });
    await expect(signup(service, { email: 'JANE@example.com' })).rejects.toThrow(SIGNUP_UNAVAILABLE_ERROR);
    await expect(
      signup(service, { email: 'other@example.com', username: 'jane' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires an identifier and enforces the password policy', async () => {
    const { service } = setup();
    await expect(
      service.signup({ password: PW } as SignupDto, IP),
    ).rejects.toThrow('Provide a username or an email');
    await expect(signup(service, { password: 'short' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(signup(service, { password: 'password123' })).rejects.toThrow(/easy to guess/);
    await expect(signup(service, { email: 'not-an-email' })).rejects.toThrow(/Email format/);
  });

  it('rate-limits signups per IP', async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i += 1) {
      await signup(service, { email: `u${i}@example.com` });
    }
    await expect(signup(service, { email: 'u11@example.com' })).rejects.toBeInstanceOf(HttpException);
    // another IP is unaffected
    await expect(signup(service, { email: 'u12@example.com' }, '198.51.100.9')).resolves.toBeDefined();
  });

  it('validates the DTO shape (whitelisted, normalised)', async () => {
    const dto = plainToInstance(SignupDto, { username: ' Jane.Doe ', email: ' A@B.CO ', password: PW });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.username).toBe('jane.doe');
    expect(dto.email).toBe('a@b.co');
    const bad = plainToInstance(SignupDto, { username: 'x y', password: PW });
    expect((await validate(bad)).length).toBeGreaterThan(0);
  });
});

describe('PasswordAuthService.login', () => {
  it('signs in with email or username and updates lastLoginAt', async () => {
    const { service, repo } = setup();
    await signup(service, { username: 'jane' });
    await expect(service.login({ identifier: 'jane@example.com', password: PW }, IP)).resolves.toMatchObject({ accessToken: 'jwt' });
    await expect(service.login({ identifier: 'jane', password: PW }, IP)).resolves.toMatchObject({ accessToken: 'jwt' });
    expect([...repo.users.values()][0].lastLoginAt).toBeInstanceOf(Date);
  });

  it('answers wrong password, unknown user, SMS-only user and inactive user identically', async () => {
    const { service, repo } = setup();
    await signup(service, { username: 'jane' });
    await repo.create({ phone: '09121234567', username: 'smsonly' });
    const inactive = [...repo.users.values()][0];
    await signup(service, { email: 'gone@example.com' });
    [...repo.users.values()].find((u) => u.loginEmail === 'gone@example.com')!.isActive = false;
    expect(inactive).toBeDefined();

    const attempts = [
      { identifier: 'jane', password: 'wrong-password-123' },
      { identifier: 'nobody', password: PW },
      { identifier: 'smsonly', password: PW },
      { identifier: 'gone@example.com', password: PW },
    ];
    for (const attempt of attempts) {
      const error = await service.login(attempt, IP).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(LOGIN_GENERIC_ERROR);
    }
  });

  it('locks an identifier+IP after 5 failures, even for the right password, without affecting other IPs', async () => {
    const { service } = setup();
    await signup(service, { username: 'jane' });
    for (let i = 0; i < 5; i += 1) {
      await expect(service.login({ identifier: 'jane', password: 'wrong-password-123' }, IP)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const locked = await service.login({ identifier: 'jane', password: PW }, IP).catch((e: unknown) => e);
    expect(locked).toBeInstanceOf(HttpException);
    expect((locked as HttpException).getStatus()).toBe(429);
    expect((locked as HttpException).message).toBe(LOGIN_RATE_LIMIT_ERROR);
    await expect(service.login({ identifier: 'jane', password: PW }, '203.0.113.5')).resolves.toBeDefined();
  });

  it('caps failures per identifier across many IPs', async () => {
    const { service } = setup();
    await signup(service, { username: 'jane' });
    for (let i = 0; i < 20; i += 1) {
      await service.login({ identifier: 'jane', password: 'wrong-password-123' }, `203.0.113.${i}`).catch(() => undefined);
    }
    const blocked = await service.login({ identifier: 'jane', password: PW }, '203.0.113.200').catch((e: unknown) => e);
    expect((blocked as HttpException).getStatus()).toBe(429);
  });

  it('upgrades a weaker stored hash on successful login', async () => {
    const { service, repo } = setup();
    await signup(service, { username: 'jane' });
    const user = [...repo.users.values()][0];
    const { scryptSync, randomBytes } = await import('crypto');
    const salt = randomBytes(16);
    const key = scryptSync(PW, salt, 64, { N: 16384, r: 8, p: 1 });
    user.passwordHash = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    await service.login({ identifier: 'jane', password: PW }, IP);
    expect(user.passwordHash.startsWith('scrypt$32768$')).toBe(true);
  });
});

describe('PasswordAuthService password reset', () => {
  const tokenSentTo = (mail: { sendPasswordReset: jest.Mock }) =>
    mail.sendPasswordReset.mock.calls.at(-1)![1] as string;

  it('answers the same for known and unknown accounts, and only mails known ones', async () => {
    const { service, mail } = setup();
    await signup(service, { username: 'jane' });
    const known = await service.forgotPassword({ identifier: 'jane@example.com' }, IP);
    const unknown = await service.forgotPassword({ identifier: 'ghost@example.com' }, IP);
    expect(known).toBe(FORGOT_GENERIC_RESPONSE);
    expect(unknown).toBe(FORGOT_GENERIC_RESPONSE);
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(mail.sendPasswordReset).toHaveBeenCalledWith('jane@example.com', expect.any(String), 'fa', 30);
  });

  it('resets once, signs every device out and lets the new password in', async () => {
    const { service, mail, refreshRepo } = setup();
    await signup(service, { username: 'jane' });
    await service.forgotPassword({ identifier: 'jane', locale: 'en' }, IP);
    const token = tokenSentTo(mail);
    expect(mail.sendPasswordReset.mock.calls[0][2]).toBe('en');

    await service.resetPassword({ token, newPassword: 'brand-new-secret-9' });
    await expect(service.login({ identifier: 'jane', password: PW }, IP)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login({ identifier: 'jane', password: 'brand-new-secret-9' }, IP)).resolves.toBeDefined();
    expect(refreshRepo.rows.filter((r) => !r.revokedAt)).toHaveLength(1); // only the fresh login
    await expect(service.resetPassword({ token, newPassword: 'another-secret-99' })).rejects.toThrow(RESET_INVALID_ERROR);
  });

  it('keeps the token valid after a weak-password attempt, rejects bogus tokens, never stores the raw token', async () => {
    const { service, mail, redis } = setup();
    await signup(service, { username: 'jane' });
    await service.forgotPassword({ identifier: 'jane' }, IP);
    const token = tokenSentTo(mail);
    expect([...redis.store.keys()].some((k) => k.includes(token))).toBe(false);
    await expect(service.resetPassword({ token, newPassword: 'short' })).rejects.toThrow(/at least 10/);
    await expect(service.resetPassword({ token, newPassword: 'good-new-password-1' })).resolves.toBeUndefined();
    await expect(
      service.resetPassword({ token: 'z'.repeat(43), newPassword: 'good-new-password-1' }),
    ).rejects.toThrow(RESET_INVALID_ERROR);
  });

  it('stops mailing after 3 requests per identifier per hour, silently', async () => {
    const { service, mail } = setup();
    await signup(service, { username: 'jane' });
    for (let i = 0; i < 6; i += 1) {
      await expect(service.forgotPassword({ identifier: 'jane' }, IP)).resolves.toBe(FORGOT_GENERIC_RESPONSE);
    }
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(3);
  });
});

describe('PasswordAuthService.setPassword (SMS user adds a password)', () => {
  const smsUser = async (repo: InMemoryAuthRepository) =>
    repo.create({ phone: '09121234567', tenantId: 'tenant-9', tenantRole: 'OWNER' as never });

  it('attaches credentials to the same account, keeping its tenant', async () => {
    const { service, repo } = setup();
    const user = await smsUser(repo);
    await service.setPassword(user.id, { newPassword: PW, email: 'Sms@Example.com' });
    expect(repo.users.size).toBe(1);
    expect(user).toMatchObject({ phone: '09121234567', loginEmail: 'sms@example.com', tenantId: 'tenant-9' });
    await expect(service.login({ identifier: 'sms@example.com', password: PW }, IP)).resolves.toMatchObject({
      user: expect.objectContaining({ id: user.id, tenantId: 'tenant-9' }),
    });
  });

  it('needs a username or email, and refuses ones that belong to someone else', async () => {
    const { service, repo } = setup();
    const user = await smsUser(repo);
    await expect(service.setPassword(user.id, { newPassword: PW })).rejects.toThrow(/username or an email/);
    await signup(service, { username: 'taken' });
    await expect(service.setPassword(user.id, { newPassword: PW, username: 'taken' })).rejects.toThrow(SIGNUP_UNAVAILABLE_ERROR);
  });

  it('requires the current password to change an existing one, and counts failures', async () => {
    const { service, repo } = setup();
    await signup(service, { username: 'jane' });
    const user = [...repo.users.values()][0];
    await expect(service.setPassword(user.id, { newPassword: 'brand-new-secret-9' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setPassword(user.id, { newPassword: 'brand-new-secret-9', currentPassword: 'wrong-password-123' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setPassword(user.id, { newPassword: 'brand-new-secret-9', currentPassword: PW }),
    ).resolves.toBeDefined();
  });

  it('revokes older sessions when the password changes', async () => {
    const { service, repo, refreshRepo } = setup();
    const first = await signup(service, { username: 'jane' });
    expect(first).toBeDefined();
    const user = [...repo.users.values()][0];
    await service.setPassword(user.id, { newPassword: 'brand-new-secret-9', currentPassword: PW });
    expect(refreshRepo.rows.filter((r) => !r.revokedAt)).toHaveLength(1);
  });

  it('does not let a user change an identifier they already have', async () => {
    const { service, repo } = setup();
    await signup(service, { username: 'jane' });
    const user = [...repo.users.values()][0];
    await expect(
      service.setPassword(user.id, { newPassword: 'brand-new-secret-9', currentPassword: PW, username: 'someone-else' }),
    ).rejects.toThrow(/cannot be changed/);
  });
});
