import {
  HttpException,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import {
  OTP_ATTEMPTS_REDIS_PREFIX,
  OTP_CODE_LENGTH,
  OTP_GENERIC_ERROR,
  OTP_MAX_ATTEMPTS,
  OTP_REDIS_PREFIX,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_LIMIT_ERROR,
  OTP_SEND_LIMIT_PER_IP,
  OTP_SEND_LIMIT_PER_PHONE,
  OTP_SEND_LIMIT_REDIS_PREFIX,
  OTP_TTL_SECONDS,
  REDIS_CLIENT,
} from '../constants/auth.constants';
import {
  AuthSessionDto,
  AuthUserDto,
  SendOtpResponseDto,
} from '../dto/auth-session.dto';
import {
  REFRESH_INVALID_ERROR,
  SMS_DELIVERY_FAILED_ERROR,
} from '../constants/password-auth.constants';
import { SendOtpDto } from '../dto/send-otp.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { UserEntity } from '../entities/user.entity';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { RedisClient } from '../providers/redis.provider';
import { AuthRepository } from '../repositories/auth.repository';
import { AuditService } from '../../access/services/audit.service';
import { InvitationsService } from '../../access/services/invitations.service';
import { OrganizationsService } from '../../access/services/organizations.service';
import { MembershipsRepository } from '../../access/repositories/memberships.repository';
import { LoginChallengeService, MfaChallenge } from './login-challenge.service';
import { MailService } from './mail.service';
import { SessionsService } from './sessions.service';
import { KavenegarService } from './kavenegar.service';
import { RefreshTokenService, SessionMeta } from './refresh-token.service';

interface OtpRecord {
  /** HMAC-SHA256 of phone + code; the code itself is never stored. */
  hash: string;
  domain: AuthServiceDomain;
  issuedAt: number;
}

/** Atomic fixed-window counter: INCR, and (re)arm the TTL when new or missing. */
const COUNT_IN_WINDOW_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c`;

/** Mask a phone for logs: 09121234567 -> 0912***67. */
const maskPhone = (phone: string): string =>
  phone.length > 6 ? `${phone.slice(0, 4)}***${phone.slice(-2)}` : '***';

interface JwtPayload {
  sub: string;
  phone: string | null;
  role: string;
  domain: AuthServiceDomain;
  tenantId: string | null;
  tenantRole: string | null;
  sid: string;
  mfa: boolean;
}

/** Network context of a sign-in; used for the session list and new-device alerts. */
export interface LoginContext {
  ip?: string;
  userAgent?: string;
  /** Prefer this organisation (e.g. the one just joined by invitation). */
  tenantId?: string | null;
}

export interface IssueOptions {
  familyId?: string;
  mfa?: boolean;
  meta?: SessionMeta;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/**
 * سرویس احراز هویت پیامکی (Auth & Kavenegar OTP).
 *
 * منطق کسب‌وکار کامل اینجا متمرکز است:
 *   • تولید کد امن ۶ رقمی با CSPRNG (crypto.randomInt)
 *   • ذخیره فقط هش HMAC کد در Redis با انقضای ۱۲۰ ثانیه، مقایسه زمان‌ثابت
 *   • شمارنده اتمیک تلاش (حداکثر ۵) و محدودیت ارسال به‌ازای شماره و IP
 *   • پیام خطای یکسان برای همه شکست‌ها؛ کد هرگز در پاسخ یا لاگ نمی‌آید
 *   • ارسال پیامک با قالب اختصاصی هر دامنه از طریق کاوه‌نگار
 *   • ایجاد/بازیابی کاربر و صدور توکن امضاشده JWT (سشن کاربری)
 *
 * Controller فقط مسیریابی و Repository فقط پرسیستنس انجام می‌دهد
 * (Rule #3 - AGENTS.md).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly kavenegarService: KavenegarService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    private readonly refreshTokens: RefreshTokenService,
    private readonly memberships: MembershipsRepository,
    private readonly organizations: OrganizationsService,
    private readonly invitations: InvitationsService,
    private readonly challenges: LoginChallengeService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * تعیین دامنه سرویس: اولویت با مقدار صریح DTO و در نبود آن استنتاج از Host.
   */
  resolveServiceDomain(
    explicit: AuthServiceDomain | undefined,
    host?: string,
  ): AuthServiceDomain {
    if (explicit) {
      return explicit;
    }
    const normalizedHost = (host ?? '').toLowerCase();
    if (
      normalizedHost.includes('ghazi') ||
      normalizedHost.includes('smartjudge')
    ) {
      return AuthServiceDomain.GHAZI;
    }
    return AuthServiceDomain.ROXIRA;
  }

  private otpKey(phone: string): string {
    return `${OTP_REDIS_PREFIX}${phone}`;
  }

  private attemptsKey(phone: string): string {
    return `${OTP_ATTEMPTS_REDIS_PREFIX}${phone}`;
  }

  /** تولید کد امن ۶ رقمی با مولد اعداد تصادفی رمزنگاری‌شده. */
  private generateOtp(): string {
    const max = 10 ** OTP_CODE_LENGTH;
    return String(randomInt(0, max)).padStart(OTP_CODE_LENGTH, '0');
  }

  /** HMAC keyed with JWT_SECRET, so a Redis dump cannot be brute-forced offline. */
  private hashOtp(phone: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`otp:${phone}:${code}`)
      .digest('hex');
  }

  private static sameHash(expected: unknown, supplied: string): boolean {
    if (typeof expected !== 'string' || expected.length !== supplied.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  }

  /**
   * Count one event in a fixed window; true when the limit is exceeded.
   * INCR and EXPIRE run in one Lua script (atomic), and a key that somehow has
   * no TTL (-1) gets one on the next hit, so a crash can never lock out forever.
   */
  private async overLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const count = Number(
      await this.redis.eval(COUNT_IN_WINDOW_LUA, 1, key, windowSeconds),
    );
    return count > limit;
  }

  /** Successful sends recorded for a phone; heals a stuck key that lost its TTL. */
  private async phoneSendCount(key: string): Promise<number> {
    const count = Number((await this.redis.get(key)) ?? 0);
    if (count > 0 && (await this.redis.ttl(key)) === -1) {
      await this.redis.expire(key, OTP_SEND_LIMIT_PER_PHONE.windowSeconds);
    }
    return count;
  }

  /**
   * Gate a send. Per-IP: every attempt counts. Per-phone: only *delivered*
   * sends count (see recordSendResult) plus a short resend cooldown, so a
   * stranger cannot lock a victim out with failed or blocked attempts.
   * Returns the cooldown key to release when the SMS fails.
   */
  private async assertSendAllowed(phone: string, ip?: string): Promise<string> {
    if (
      ip &&
      (await this.overLimit(
        `${OTP_SEND_LIMIT_REDIS_PREFIX}ip:${ip}`,
        OTP_SEND_LIMIT_PER_IP.limit,
        OTP_SEND_LIMIT_PER_IP.windowSeconds,
      ))
    ) {
      throw new HttpException(OTP_SEND_LIMIT_ERROR, HttpStatus.TOO_MANY_REQUESTS);
    }
    const sentKey = `${OTP_SEND_LIMIT_REDIS_PREFIX}phone:${phone}`;
    if ((await this.phoneSendCount(sentKey)) >= OTP_SEND_LIMIT_PER_PHONE.limit) {
      throw new HttpException(OTP_SEND_LIMIT_ERROR, HttpStatus.TOO_MANY_REQUESTS);
    }
    const cooldownKey = `${OTP_SEND_LIMIT_REDIS_PREFIX}cd:${phone}`;
    const acquired = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (acquired === null) {
      throw new HttpException(OTP_SEND_LIMIT_ERROR, HttpStatus.TOO_MANY_REQUESTS);
    }
    return cooldownKey;
  }

  private async recordSendResult(
    phone: string,
    cooldownKey: string,
    delivered: boolean,
  ): Promise<void> {
    if (delivered) {
      await this.redis.eval(
        COUNT_IN_WINDOW_LUA,
        1,
        `${OTP_SEND_LIMIT_REDIS_PREFIX}phone:${phone}`,
        OTP_SEND_LIMIT_PER_PHONE.windowSeconds,
      );
    } else {
      await this.redis.del(cooldownKey);
    }
  }

  /**
   * ارسال کد یک‌بارمصرف:
   *   ۱) تولید و ذخیره کد در Redis با انقضای ۱۲۰ ثانیه
   *   ۲) ارسال پیامک با قالب دامنه از طریق کاوه‌نگار
   */
  async sendOtp(
    dto: SendOtpDto,
    host?: string,
    ip?: string,
  ): Promise<SendOtpResponseDto> {
    const domain = this.resolveServiceDomain(dto.serviceDomain, host);
    const phone = dto.phone;
    const cooldownKey = await this.assertSendAllowed(phone, ip);
    const code = this.generateOtp();

    const record: OtpRecord = {
      hash: this.hashOtp(phone, code),
      domain,
      issuedAt: Date.now(),
    };

    await this.redis.del(this.attemptsKey(phone));
    await this.redis.set(
      this.otpKey(phone),
      JSON.stringify(record),
      'EX',
      OTP_TTL_SECONDS,
    );

    const smsDelivered = await this.kavenegarService.sendVerificationCode(
      phone,
      code,
      domain,
    );

    await this.recordSendResult(phone, cooldownKey, smsDelivered === true);

    if (smsDelivered !== true) {
      // The code was never delivered: drop it and tell the client plainly so it
      // can offer password sign-in instead of waiting for an SMS that will not come.
      await this.redis.del(this.otpKey(phone), this.attemptsKey(phone));
      this.logger.warn(
        `[AUTH] SMS not delivered | phone=${maskPhone(phone)} | domain=${domain}`,
      );
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'SMS_DELIVERY_FAILED',
        message: SMS_DELIVERY_FAILED_ERROR,
      });
    }

    this.logger.log(
      `[AUTH] OTP صادر شد | phone=${maskPhone(phone)} | domain=${domain} | smsDelivered=${smsDelivered} | ttl=${OTP_TTL_SECONDS}s`,
    );

    return {
      success: true,
      expiresIn: OTP_TTL_SECONDS,
      serviceDomain: domain,
      smsDelivered,
      template: this.kavenegarService.templateFor(domain),
    };
  }

  /**
   * تأیید کد یک‌بارمصرف:
   *   • بررسی تطابق کد ذخیره‌شده در Redis و کنترل تعداد تلاش
   *   • ایجاد/بازیابی کاربر
   *   • صدور توکن امضاشده JWT و بازگرداندن سشن کامل
   */
  async verifyOtp(dto: VerifyOtpDto, host?: string, ctx: LoginContext = {}): Promise<AuthSessionDto | MfaChallenge> {
    const domain = this.resolveServiceDomain(dto.serviceDomain, host);
    const phone = dto.phone;
    const key = this.otpKey(phone);
    const attemptsKey = this.attemptsKey(phone);

    const raw = await this.redis.get(key);
    if (!raw) {
      throw new UnauthorizedException(OTP_GENERIC_ERROR);
    }

    let record: OtpRecord;
    try {
      record = JSON.parse(raw) as OtpRecord;
    } catch {
      await this.redis.del(key);
      throw new UnauthorizedException(OTP_GENERIC_ERROR);
    }

    // Every verify counts before the compare (atomic INCR), so parallel guesses
    // cannot slip past the limit; the 6th try fails even with the right code.
    if (await this.overLimit(attemptsKey, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS)) {
      await this.redis.del(key, attemptsKey);
      throw new UnauthorizedException(OTP_GENERIC_ERROR);
    }

    if (!AuthService.sameHash(record.hash, this.hashOtp(phone, dto.code))) {
      throw new UnauthorizedException(OTP_GENERIC_ERROR);
    }

    // Single use: only the request that actually deletes the code wins.
    if ((await this.redis.del(key)) === 0) {
      throw new UnauthorizedException(OTP_GENERIC_ERROR);
    }
    await this.redis.del(attemptsKey);

    const { user } = await this.authRepository.findOrCreateByPhone(
      phone,
      record.domain ?? domain,
    );

    const loginCtx = { ...ctx };
    if (dto.inviteToken) {
      loginCtx.tenantId = (await this.invitations.accept(user.id, dto.inviteToken)).tenantId;
    } else {
      await this.applyOrganizationOnboarding(user, dto.organizationName);
    }

    const session = await this.completeLogin(user, loginCtx);

    this.logger.log(
      `[AUTH] ورود موفق | phone=${maskPhone(phone)} | userId=${user.id}`,
    );

    return session;
  }

  /**
   * ثبت‌اولیه سازمان: فقط وقتی نام سازمان داده شده و کاربر هنوز عضو هیچ
   * سازمانی نیست. (نام سازمان اختیاری است؛ کاربر می‌تواند بعداً سازمان بسازد.)
   */
  private async applyOrganizationOnboarding(
    user: UserEntity,
    organizationName?: string,
  ): Promise<void> {
    if (!organizationName) {
      return;
    }
    if ((await this.memberships.listForUser(user.id)).length > 0) {
      return;
    }
    await this.organizations.create(user.id, organizationName);
  }

  /**
   * Organisation a new session starts in: the requested one if the user is an
   * ACTIVE member, else the last active one, else the first membership, else none.
   */
  private async pickTenant(user: UserEntity, requested?: string | null): Promise<string | null> {
    const active = (await this.memberships.listForUser(user.id)).filter((m) => m.status === 'ACTIVE');
    const ids = active.map((m) => m.tenantId);
    if (requested && ids.includes(requested)) return requested;
    if (user.tenantId && ids.includes(user.tenantId)) return user.tenantId;
    return ids[0] ?? null;
  }

  /**
   * Single place where a verified identity becomes a session. If the account
   * has TOTP and no stronger factor was used (passkey), the caller gets a
   * challenge to complete at POST /auth/login/mfa instead of tokens.
   */
  async completeLogin(
    user: UserEntity,
    ctx: LoginContext = {},
    opts: { strongFactor?: boolean } = {},
  ): Promise<AuthSessionDto | MfaChallenge> {
    const strong = opts.strongFactor === true;
    if (!strong && (await this.challenges.needsSecondFactor(user.id))) {
      return this.challenges.create(user.id, ctx);
    }
    return this.finishLogin(user, ctx, strong);
  }

  /** Second step for TOTP accounts: challenge + code -> session. */
  async verifyMfa(challenge: string, code: string): Promise<AuthSessionDto> {
    const { userId, ctx } = await this.challenges.complete(challenge, code);
    const user = await this.authRepository.findById(userId);
    if (!user || !user.isActive) throw new UnauthorizedException('Sign-in failed.');
    return this.finishLogin(user, ctx, true);
  }

  private async finishLogin(user: UserEntity, ctx: LoginContext, mfa: boolean): Promise<AuthSessionDto> {
    const tenantId = await this.pickTenant(user, ctx.tenantId);
    const deviceHash = sha256(ctx.userAgent ?? 'unknown');
    const newDevice = await this.refreshTokens.isNewDevice(user.id, deviceHash);
    const session = await this.issueSessionForUser(user, {
      mfa,
      meta: { tenantId, mfa, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, deviceHash, sessionStartedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      actorUserId: user.id,
      action: newDevice ? 'auth.login.new_device' : 'auth.login',
      metadata: { mfa },
      request: { ip: ctx.ip, headers: { 'user-agent': ctx.userAgent } } as never,
    });
    const to = user.loginEmail ?? user.email;
    if (newDevice && to) {
      void this.mail.sendSecurityAlert(
        to,
        'New sign-in to your Roxira account',
        `We noticed a sign-in from a new device (${ctx.userAgent?.slice(0, 80) ?? 'unknown'}, IP ${ctx.ip ?? 'unknown'}).\n\nIf this was you, no action is needed. If not, change your password and end unknown sessions under Settings > Security.`,
      );
    }
    return session;
  }

  /**
   * Sign the access token and issue the matching refresh token. The token only
   * *selects* an organisation; AccessGuard re-verifies everything per request.
   */
  async issueSessionForUser(user: UserEntity, opts: IssueOptions = {}): Promise<AuthSessionDto> {
    const familyId = opts.familyId ?? randomUUID();
    const meta: SessionMeta = { ...opts.meta };
    if (meta.tenantId === undefined) meta.tenantId = await this.pickTenant(user);
    meta.mfa = opts.mfa ?? meta.mfa ?? false;
    const payload: JwtPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      domain: user.serviceDomain,
      tenantId: meta.tenantId ?? null,
      tenantRole: null,
      sid: familyId,
      mfa: meta.mfa,
    };
    if (payload.tenantId) {
      const m = await this.memberships.findByTenantUser(payload.tenantId, user.id);
      payload.tenantRole = m?.roleKey === 'owner' ? 'OWNER' : m ? 'MEMBER' : null;
    }

    const accessToken = await this.jwtService.signAsync(payload);
    const refresh = await this.refreshTokens.issue(user, familyId, meta);

    return {
      tokenType: 'Bearer',
      accessToken,
      expiresIn: this.expiresInSeconds(accessToken),
      refreshToken: refresh.token,
      refreshExpiresIn: refresh.expiresIn,
      user: AuthUserDto.fromEntity(user),
    };
  }

  /**
   * Rotate a refresh token: the old one is revoked, a new access + refresh
   * pair is issued in the same session, keeping its organisation and 2FA flag.
   * Inactive users lose their session here.
   */
  async refreshSession(refreshToken: string, ctx: LoginContext = {}): Promise<AuthSessionDto> {
    const { userId, familyId, meta } = await this.refreshTokens.consume(refreshToken);
    const user = await this.authRepository.findById(userId);
    if (!user || !user.isActive) {
      await this.refreshTokens.revokeAllForUser(userId);
      throw new UnauthorizedException(REFRESH_INVALID_ERROR);
    }
    const tenantId = await this.pickTenant(user, meta.tenantId);
    return this.issueSessionForUser(user, {
      familyId,
      mfa: meta.mfa,
      meta: { ...meta, tenantId, ip: ctx.ip ?? meta.ip, userAgent: ctx.userAgent ?? meta.userAgent },
    });
  }

  /** Re-point the current session at another organisation the user belongs to and sign a new access token. */
  async switchTenant(
    claims: { sub: string; sid?: string; mfa?: boolean },
    tenantId: string,
    request?: Parameters<AuditService['record']>[0]['request'],
  ): Promise<{ accessToken: string; expiresIn: number; tenantId: string }> {
    await this.sessions.switchTenant(claims.sub, claims.sid, tenantId, request);
    const user = await this.authRepository.findById(claims.sub);
    if (!user || !user.isActive) throw new UnauthorizedException('Sign in again.');
    const m = await this.memberships.findByTenantUser(tenantId, user.id);
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      domain: user.serviceDomain,
      tenantId,
      tenantRole: m?.roleKey === 'owner' ? 'OWNER' : 'MEMBER',
      sid: claims.sid,
      mfa: claims.mfa === true,
    });
    return { accessToken, expiresIn: this.expiresInSeconds(accessToken), tenantId };
  }

  /** Server-side logout: revoke the refresh-token family (idempotent). */
  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(refreshToken);
  }

  /** دریافت سشن/پروفایل کاربر جاری بر اساس شناسه توکن. */
  async getProfile(userId: string): Promise<AuthUserDto> {
    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('کاربر یافت نشد.');
    }
    return AuthUserDto.fromEntity(user);
  }

  /** Lifetime of the token we just signed, read from its own claims. */
  private expiresInSeconds(accessToken: string): number {
    const claims = this.jwtService.decode(accessToken) as
      | { exp?: number; iat?: number }
      | null;
    if (claims?.exp && claims.iat && claims.exp > claims.iat) {
      return claims.exp - claims.iat;
    }
    return 900;
  }
}
