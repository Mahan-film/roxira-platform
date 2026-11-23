import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  JWT_DEFAULT_EXPIRES_IN,
} from './constants/auth.constants';
import { TenantsModule } from '../tenants/tenants.module';
import { AccessModule } from '../access/access.module';
import { AuthController } from './controllers/auth.controller';
import { UserEntity } from './entities/user.entity';
import { PasskeyCredentialEntity } from './entities/passkey-credential.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserTotpEntity } from './entities/user-totp.entity';
import { TotpRepository } from './repositories/totp.repository';
import { TotpService } from './services/totp.service';
import { LoginChallengeService } from './services/login-challenge.service';
import { SessionsService } from './services/sessions.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { redisClientProvider } from './providers/redis.provider';
import { AuthRepository } from './repositories/auth.repository';
import { PasskeyRepository } from './repositories/passkey.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { AuthService } from './services/auth.service';
import { KavenegarService } from './services/kavenegar.service';
import { MailService } from './services/mail.service';
import { PasswordAuthService } from './services/password-auth.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { WebAuthnService } from './services/webauthn.service';

/**
 * ماژول احراز هویت پیامکی (Auth & Kavenegar OTP).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (تولید/بررسی OTP، کاربر، توکن JWT).
 * - Repository: تنها لایه با دسترسی مستقیم به جدول users.
 *
 * وابستگی‌های بیرونی:
 * - Redis (ioredis): ذخیره کد با انقضای ۱۲۰ ثانیه.
 * - Kavenegar Verify Lookup: ارسال پیامک قالب‌محور.
 * - @nestjs/jwt: صدور/بررسی توکن امضاشده.
 *
 * بدون هیچ import چرخه‌ای با سایر ماژول‌ها.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      PasskeyCredentialEntity,
      RefreshTokenEntity,
      UserTotpEntity,
    ]),
    TenantsModule,
    AccessModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>(
            'JWT_EXPIRES_IN',
            JWT_DEFAULT_EXPIRES_IN,
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    WebAuthnService,
    AuthRepository,
    PasskeyRepository,
    KavenegarService,
    MailService,
    PasswordAuthService,
    RefreshTokenService,
    RefreshTokenRepository,
    TotpRepository,
    TotpService,
    LoginChallengeService,
    SessionsService,
    JwtAuthGuard,
    redisClientProvider,
  ],
  exports: [AuthService, WebAuthnService, JwtModule],
})
export class AuthModule {}
