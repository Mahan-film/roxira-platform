import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import {
  JWT_DEFAULT_EXPIRES_IN_SECONDS,
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
import { SendOtpDto } from '../dto/send-otp.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { UserEntity } from '../entities/user.entity';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { RedisClient } from '../providers/redis.provider';
import { AuthRepository } from '../repositories/auth.repository';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { TenantsService } from '../../tenants/services/tenants.service';
import { KavenegarService } from './kavenegar.service';

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
  phone: string;
  role: string;
  domain: AuthServiceDomain;
  tenantId: string | null;
  tenantRole: string | null;
}

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
    private readonly tenantsService: TenantsService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
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
  async verifyOtp(dto: VerifyOtpDto, host?: string): Promise<AuthSessionDto> {
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

    await this.applyOrganizationOnboarding(user, dto.organizationName);

    const session = await this.issueSessionForUser(user);

    this.logger.log(
      `[AUTH] ورود موفق | phone=${maskPhone(phone)} | userId=${user.id}`,
    );

    return session;
  }

  /**
   * ثبت‌اولیه سازمان برای کاربر بدون مستأجر.
   *
   * اگر کاربر هنوز به هیچ سازمانی متصل نباشد و نام سازمان داده شده باشد،
   * سازمان جدید ساخته و کاربر به‌عنوان `OWNER` به آن متصل می‌شود. در صورت
   * داشتن مستأجر، نام سازمان نادیده گرفته می‌شود. نقش سراسری کاربر هرگز
   * `UserRole.ADMIN` نمی‌شود؛ اختیارات سازمانی فقط از `tenant_role` می‌آید.
   */
  private async applyOrganizationOnboarding(
    user: UserEntity,
    organizationName?: string,
  ): Promise<void> {
    if (user.tenantId || !organizationName) {
      return;
    }

    const tenant = await this.tenantsService.create(organizationName);
    user.tenantId = tenant.id;
    user.tenantRole = TenantRole.OWNER;
    await this.authRepository.save(user);
  }

  /**
   * صدور سشن JWT برای کاربر (مشترک میان ورود پیامکی و ورود Passkey/WebAuthn).
   * منطق توکن فقط در یک نقطه متمرکز می‌ماند تا از تکرار و انحراف قرارداد
   * جلوگیری شود (Rule #3 — AGENTS.md).
   */
  async issueSessionForUser(user: UserEntity): Promise<AuthSessionDto> {
    const payload: JwtPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      domain: user.serviceDomain,
      tenantId: user.tenantId ?? null,
      tenantRole: user.tenantRole ?? null,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      tokenType: 'Bearer',
      accessToken,
      expiresIn: this.expiresInSeconds(),
      user: AuthUserDto.fromEntity(user),
    };
  }

  /** دریافت سشن/پروفایل کاربر جاری بر اساس شناسه توکن. */
  async getProfile(userId: string): Promise<AuthUserDto> {
    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('کاربر یافت نشد.');
    }
    return AuthUserDto.fromEntity(user);
  }

  private expiresInSeconds(): number {
    const configured = Number(
      this.config.get<string>('JWT_EXPIRES_IN_SECONDS', ''),
    );
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return JWT_DEFAULT_EXPIRES_IN_SECONDS;
  }
}
