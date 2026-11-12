import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  FORGOT_GENERIC_RESPONSE,
  FORGOT_LIMIT_PER_IDENTIFIER,
  FORGOT_LIMIT_PER_IP,
  FORGOT_LIMIT_REDIS_PREFIX,
  LOGIN_FAIL_LIMIT_PER_IDENTIFIER,
  LOGIN_FAIL_LIMIT_PER_IDENTIFIER_IP,
  LOGIN_FAIL_REDIS_PREFIX,
  LOGIN_FAIL_WINDOW_SECONDS,
  LOGIN_GENERIC_ERROR,
  LOGIN_RATE_LIMIT_ERROR,
  RESET_INVALID_ERROR,
  RESET_TOKEN_BYTES,
  RESET_TOKEN_REDIS_PREFIX,
  RESET_TOKEN_TTL_SECONDS,
  SIGNUP_LIMIT_PER_IP,
  SIGNUP_LIMIT_REDIS_PREFIX,
  SIGNUP_UNAVAILABLE_ERROR,
  UiLocale,
} from '../constants/password-auth.constants';
import { REDIS_CLIENT } from '../constants/auth.constants';
import { AuthSessionDto } from '../dto/auth-session.dto';
import {
  ForgotPasswordDto,
  PasswordLoginDto,
  ResetPasswordDto,
  SetPasswordDto,
  SignupDto,
} from '../dto/password-auth.dto';
import { UserEntity } from '../entities/user.entity';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { RedisClient } from '../providers/redis.provider';
import { AuthRepository } from '../repositories/auth.repository';
import { AuditService } from '../../access/services/audit.service';
import { InvitationsService } from '../../access/services/invitations.service';
import { OrganizationsService } from '../../access/services/organizations.service';
import { BREACHED_PASSWORD_ERROR, isBreachedPassword } from '../utils/breach-check.util';
import { MfaChallenge } from './login-challenge.service';
import {
  getDummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../utils/password-hasher.util';
import {
  isEmail,
  isUsername,
  normalizeEmail,
  normalizeUsername,
  parseLoginIdentifier,
  passwordPolicyViolation,
} from '../utils/identifier.util';
import { AuthService, LoginContext } from './auth.service';
import { MailService } from './mail.service';
import { RefreshTokenService } from './refresh-token.service';

const COUNT_IN_WINDOW_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c`;

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { driverError?: { code?: string } }).driverError?.code === '23505');

/**
 * Username/email + password authentication.
 *
 * - Passwords: scrypt, policy checked on signup/reset/set only.
 * - Every failed login returns the same 401 whatever the cause, and costs the
 *   same time (a dummy hash is verified for unknown accounts).
 * - Failed logins are counted per (identifier, IP) and per identifier in Redis.
 * - Reset tokens are random, stored only as SHA-256 in Redis for 30 minutes,
 *   single use; a reset revokes every refresh token of the user.
 */
@Injectable()
export class PasswordAuthService {
  private readonly logger = new Logger(PasswordAuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly authService: AuthService,
    private readonly organizations: OrganizationsService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly mail: MailService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
  ) {}

  private async count(key: string, windowSeconds: number): Promise<number> {
    return Number(await this.redis.eval(COUNT_IN_WINDOW_LUA, 1, key, windowSeconds));
  }

  private async peek(key: string): Promise<number> {
    return Number((await this.redis.get(key)) ?? 0);
  }

  // ---------------------------------------------------------------- signup

  async signup(dto: SignupDto, ip?: string, ctx: LoginContext = {}): Promise<AuthSessionDto | MfaChallenge> {
    if (
      ip &&
      (await this.count(`${SIGNUP_LIMIT_REDIS_PREFIX}${ip}`, SIGNUP_LIMIT_PER_IP.windowSeconds)) >
        SIGNUP_LIMIT_PER_IP.limit
    ) {
      throw new HttpException(LOGIN_RATE_LIMIT_ERROR, HttpStatus.TOO_MANY_REQUESTS);
    }

    const username = dto.username ? normalizeUsername(dto.username) : null;
    const email = dto.email ? normalizeEmail(dto.email) : null;
    if (!username && !email) {
      throw new BadRequestException('Provide a username or an email.');
    }
    if (username && !isUsername(username)) {
      throw new BadRequestException('Username format is not valid.');
    }
    if (email && !isEmail(email)) {
      throw new BadRequestException('Email format is not valid.');
    }
    const violation = passwordPolicyViolation(dto.password, [username ?? '', email ?? '']);
    if (violation) {
      throw new BadRequestException(violation);
    }
    if (await isBreachedPassword(dto.password)) {
      throw new BadRequestException(BREACHED_PASSWORD_ERROR);
    }

    if (
      (username && (await this.authRepository.findByUsername(username))) ||
      (email && (await this.authRepository.findByLoginEmail(email)))
    ) {
      throw new ConflictException(SIGNUP_UNAVAILABLE_ERROR);
    }

    const passwordHash = await hashPassword(dto.password);
    let user: UserEntity;
    try {
      user = await this.authRepository.create({
        phone: null,
        username,
        loginEmail: email,
        email,
        displayName: dto.displayName || null,
        passwordHash,
        passwordUpdatedAt: new Date(),
        serviceDomain: AuthServiceDomain.ROXIRA,
        lastLoginAt: new Date(),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(SIGNUP_UNAVAILABLE_ERROR);
      }
      throw error;
    }

    // No organisation is forced on a new account. A name creates one now; an
    // invitation joins an existing one (staff are never asked for a name);
    // otherwise the person creates or joins one later.
    const loginCtx: LoginContext = { ...ctx, ip: ctx.ip ?? ip };
    if (dto.inviteToken) {
      loginCtx.tenantId = (await this.invitations.accept(user.id, dto.inviteToken)).tenantId;
    } else if (dto.organizationName) {
      loginCtx.tenantId = (await this.organizations.create(user.id, dto.organizationName.slice(0, 150))).tenantId;
    }

    this.logger.log(`[AUTH] password signup | userId=${user.id} | tenantId=${loginCtx.tenantId ?? '-'}`);
    return this.authService.completeLogin(user, loginCtx);
  }

  // ----------------------------------------------------------------- login

  async login(dto: PasswordLoginDto, ip?: string, ctx: LoginContext = {}): Promise<AuthSessionDto | MfaChallenge> {
    const identifier = parseLoginIdentifier(dto.identifier);
    const idKey = digest(identifier.value);
    const ipKey = `${LOGIN_FAIL_REDIS_PREFIX}ip:${ip ?? '-'}:${idKey}`;
    const accountKey = `${LOGIN_FAIL_REDIS_PREFIX}id:${idKey}`;

    if (
      (await this.peek(ipKey)) >= LOGIN_FAIL_LIMIT_PER_IDENTIFIER_IP ||
      (await this.peek(accountKey)) >= LOGIN_FAIL_LIMIT_PER_IDENTIFIER
    ) {
      // Locked out: record it (once per attempt) against the account's organisation.
      const locked = await this.authRepository.findWithPasswordHash(
        identifier.kind === 'email' ? { loginEmail: identifier.value } : { username: identifier.value },
      );
      await this.audit.record({
        tenantId: locked?.tenantId ?? null,
        actorUserId: locked?.id ?? null,
        action: 'auth.login.locked',
        request: { ip, headers: { 'user-agent': ctx.userAgent } } as never,
      });
      throw new HttpException(LOGIN_RATE_LIMIT_ERROR, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.authRepository.findWithPasswordHash(
      identifier.kind === 'email'
        ? { loginEmail: identifier.value }
        : { username: identifier.value },
    );
    const storedHash = user?.passwordHash ?? (await getDummyHash());
    const passwordOk = await verifyPassword(dto.password, storedHash);

    if (!user || !user.passwordHash || !passwordOk || !user.isActive) {
      await this.count(ipKey, LOGIN_FAIL_WINDOW_SECONDS);
      await this.count(accountKey, LOGIN_FAIL_WINDOW_SECONDS);
      if (user) {
        await this.audit.record({
          tenantId: user.tenantId ?? null,
          actorUserId: user.id,
          action: 'auth.login.failed',
          request: { ip, headers: { 'user-agent': ctx.userAgent } } as never,
        });
      }
      throw new UnauthorizedException(LOGIN_GENERIC_ERROR);
    }

    await this.redis.del(ipKey);
    if (needsRehash(user.passwordHash)) {
      user.passwordHash = await hashPassword(dto.password);
      user.passwordUpdatedAt = new Date();
    }
    user.lastLoginAt = new Date();
    const saved = await this.authRepository.save(user);

    this.logger.log(`[AUTH] password login | userId=${saved.id}`);
    return this.authService.completeLogin(saved, { ...ctx, ip: ctx.ip ?? ip });
  }

  // ----------------------------------------------------- forgot / reset

  /** Always resolves with the same message; unknown accounts and rate-limited requests are silent. */
  async forgotPassword(dto: ForgotPasswordDto, ip?: string): Promise<string> {
    const identifier = parseLoginIdentifier(dto.identifier);
    const locale: UiLocale = dto.locale ?? 'fa';

    const overIp =
      ip &&
      (await this.count(`${FORGOT_LIMIT_REDIS_PREFIX}ip:${ip}`, FORGOT_LIMIT_PER_IP.windowSeconds)) >
        FORGOT_LIMIT_PER_IP.limit;
    const overId =
      (await this.count(
        `${FORGOT_LIMIT_REDIS_PREFIX}id:${digest(identifier.value)}`,
        FORGOT_LIMIT_PER_IDENTIFIER.windowSeconds,
      )) > FORGOT_LIMIT_PER_IDENTIFIER.limit;
    if (overIp || overId) {
      return FORGOT_GENERIC_RESPONSE;
    }

    const user =
      identifier.kind === 'email'
        ? await this.authRepository.findByLoginEmail(identifier.value)
        : await this.authRepository.findByUsername(identifier.value);

    if (user?.loginEmail && user.isActive) {
      const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
      await this.redis.set(
        `${RESET_TOKEN_REDIS_PREFIX}${digest(token)}`,
        user.id,
        'EX',
        RESET_TOKEN_TTL_SECONDS,
      );
      // Not awaited: response time must not reveal whether an email was sent.
      void this.mail.sendPasswordReset(
        user.loginEmail,
        token,
        locale,
        Math.round(RESET_TOKEN_TTL_SECONDS / 60),
      );
    }
    return FORGOT_GENERIC_RESPONSE;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const key = `${RESET_TOKEN_REDIS_PREFIX}${digest(dto.token)}`;
    const userId = await this.redis.get(key);
    if (!userId) {
      throw new BadRequestException(RESET_INVALID_ERROR);
    }
    const user = await this.authRepository.findById(userId, { callerUserId: userId });
    if (!user || !user.isActive) {
      await this.redis.del(key);
      throw new BadRequestException(RESET_INVALID_ERROR);
    }
    const violation = passwordPolicyViolation(dto.newPassword, [
      user.username ?? '',
      user.loginEmail ?? '',
    ]);
    if (violation) {
      // Token stays valid so the user can retry with a better password.
      throw new BadRequestException(violation);
    }
    if (await isBreachedPassword(dto.newPassword)) {
      throw new BadRequestException(BREACHED_PASSWORD_ERROR);
    }
    // Single use: only the request that deletes the key wins.
    if ((await this.redis.del(key)) === 0) {
      throw new BadRequestException(RESET_INVALID_ERROR);
    }
    user.passwordHash = await hashPassword(dto.newPassword);
    user.passwordUpdatedAt = new Date();
    await this.authRepository.save(user);
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.redis.del(
      `${LOGIN_FAIL_REDIS_PREFIX}id:${digest(user.username ?? '')}`,
      `${LOGIN_FAIL_REDIS_PREFIX}id:${digest(user.loginEmail ?? '')}`,
    );
    this.logger.log(`[AUTH] password reset | userId=${user.id}`);
  }

  // ------------------------------------------------------ set password

  /**
   * Add or change the password of the signed-in user. An SMS-only user passes
   * a username and/or email so the same account can also sign in with a password.
   * Returns a fresh session; all older refresh tokens are revoked.
   */
  async setPassword(
    userId: string,
    dto: SetPasswordDto,
    current: { mfa?: boolean; tenantId?: string | null; ip?: string; userAgent?: string } = {},
  ): Promise<AuthSessionDto> {
    const user = await this.authRepository.findWithPasswordHash({ id: userId }, userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Not signed in.');
    }

    if (user.passwordHash) {
      const failKey = `${LOGIN_FAIL_REDIS_PREFIX}set:${user.id}`;
      if ((await this.peek(failKey)) >= LOGIN_FAIL_LIMIT_PER_IDENTIFIER_IP) {
        throw new HttpException(LOGIN_RATE_LIMIT_ERROR, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!dto.currentPassword || !(await verifyPassword(dto.currentPassword, user.passwordHash))) {
        await this.count(failKey, LOGIN_FAIL_WINDOW_SECONDS);
        throw new ForbiddenException('Current password is incorrect.');
      }
      await this.redis.del(failKey);
    }

    const username = dto.username ? normalizeUsername(dto.username) : null;
    const email = dto.email ? normalizeEmail(dto.email) : null;
    if (username) {
      if (user.username && user.username !== username) {
        throw new BadRequestException('The username of this account cannot be changed.');
      }
      if (!isUsername(username)) throw new BadRequestException('Username format is not valid.');
    }
    if (email) {
      if (user.loginEmail && user.loginEmail !== email) {
        throw new BadRequestException('The email of this account cannot be changed.');
      }
      if (!isEmail(email)) throw new BadRequestException('Email format is not valid.');
    }

    const finalUsername = user.username ?? username;
    const finalEmail = user.loginEmail ?? email;
    if (!finalUsername && !finalEmail) {
      throw new BadRequestException('Provide a username or an email to sign in with.');
    }
    const violation = passwordPolicyViolation(dto.newPassword, [
      finalUsername ?? '',
      finalEmail ?? '',
    ]);
    if (violation) throw new BadRequestException(violation);
    if (await isBreachedPassword(dto.newPassword)) throw new BadRequestException(BREACHED_PASSWORD_ERROR);

    if (username && !user.username) {
      const taken = await this.authRepository.findByUsername(username);
      if (taken && taken.id !== user.id) throw new ConflictException(SIGNUP_UNAVAILABLE_ERROR);
    }
    if (email && !user.loginEmail) {
      const taken = await this.authRepository.findByLoginEmail(email);
      if (taken && taken.id !== user.id) throw new ConflictException(SIGNUP_UNAVAILABLE_ERROR);
    }

    user.username = finalUsername;
    user.loginEmail = finalEmail;
    user.email = user.email ?? finalEmail;
    user.passwordHash = await hashPassword(dto.newPassword);
    user.passwordUpdatedAt = new Date();
    try {
      await this.authRepository.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(SIGNUP_UNAVAILABLE_ERROR);
      throw error;
    }
    await this.refreshTokens.revokeAllForUser(user.id);
    this.logger.log(`[AUTH] password set | userId=${user.id}`);
    await this.audit.record({ tenantId: current.tenantId ?? null, actorUserId: user.id, action: 'auth.password.set' });
    // Keep the caller's organisation and second-factor state in the fresh session.
    return this.authService.issueSessionForUser(user, {
      mfa: current.mfa ?? false,
      meta: { tenantId: current.tenantId, mfa: current.mfa ?? false, ip: current.ip, userAgent: current.userAgent, sessionStartedAt: new Date() },
    });
  }
}
