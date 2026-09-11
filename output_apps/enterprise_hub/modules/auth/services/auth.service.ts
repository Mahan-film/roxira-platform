import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'crypto';
import {
  JWT_DEFAULT_EXPIRES_IN_SECONDS,
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_REDIS_PREFIX,
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
import { KavenegarService } from './kavenegar.service';

interface OtpRecord {
  code: string;
  attempts: number;
  domain: AuthServiceDomain;
  issuedAt: number;
}

interface JwtPayload {
  sub: string;
  phone: string;
  role: string;
  domain: AuthServiceDomain;
}

/**
 * سرویس احراز هویت پیامکی (Auth & Kavenegar OTP).
 *
 * منطق کسب‌وکار کامل اینجا متمرکز است:
 *   • تولید کد امن ۵ رقمی با CSPRNG (crypto.randomInt)
 *   • ذخیره در Redis با انقضای ۱۲۰ ثانیه + شمارنده تلاش ضد Brute-Force
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

  /** تولید کد امن ۵ رقمی با مولد اعداد تصادفی رمزنگاری‌شده. */
  private generateOtp(): string {
    const max = 10 ** OTP_CODE_LENGTH;
    return String(randomInt(0, max)).padStart(OTP_CODE_LENGTH, '0');
  }

  /**
   * ارسال کد یک‌بارمصرف:
   *   ۱) تولید و ذخیره کد در Redis با انقضای ۱۲۰ ثانیه
   *   ۲) ارسال پیامک با قالب دامنه از طریق کاوه‌نگار
   */
  async sendOtp(
    dto: SendOtpDto,
    host?: string,
  ): Promise<SendOtpResponseDto> {
    const domain = this.resolveServiceDomain(dto.serviceDomain, host);
    const phone = dto.phone;
    const code = this.generateOtp();

    const record: OtpRecord = {
      code,
      attempts: 0,
      domain,
      issuedAt: Date.now(),
    };

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

    this.logger.log(
      `[AUTH] OTP صادر شد | phone=${phone} | domain=${domain} | smsDelivered=${smsDelivered} | ttl=${OTP_TTL_SECONDS}s`,
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

    const raw = await this.redis.get(key);
    if (!raw) {
      throw new UnauthorizedException(
        'کد تأیید منقضی شده یا یافت نشد؛ لطفاً دوباره درخواست کنید.',
      );
    }

    let record: OtpRecord;
    try {
      record = JSON.parse(raw) as OtpRecord;
    } catch {
      await this.redis.del(key);
      throw new UnauthorizedException('کد تأیید نامعتبر است.');
    }

    if (record.code !== dto.code) {
      record.attempts += 1;
      if (record.attempts >= OTP_MAX_ATTEMPTS) {
        await this.redis.del(key);
        throw new UnauthorizedException(
          'تعداد تلاش‌های ناموفق بیش از حد مجاز شد؛ لطفاً کد جدید درخواست کنید.',
        );
      }
      await this.redis.set(key, JSON.stringify(record), 'KEEPTTL');
      throw new UnauthorizedException('کد تأیید نادرست است.');
    }

    await this.redis.del(key);

    const { user } = await this.authRepository.findOrCreateByPhone(
      phone,
      record.domain ?? domain,
    );

    const session = await this.issueSessionForUser(user);

    this.logger.log(`[AUTH] ورود موفق | phone=${phone} | userId=${user.id}`);

    return session;
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
