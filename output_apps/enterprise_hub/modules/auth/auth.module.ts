import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  JWT_DEFAULT_EXPIRES_IN,
} from './constants/auth.constants';
import { AuthController } from './controllers/auth.controller';
import { UserEntity } from './entities/user.entity';
import { PasskeyCredentialEntity } from './entities/passkey-credential.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { redisClientProvider } from './providers/redis.provider';
import { AuthRepository } from './repositories/auth.repository';
import { PasskeyRepository } from './repositories/passkey.repository';
import { AuthService } from './services/auth.service';
import { KavenegarService } from './services/kavenegar.service';
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
    TypeOrmModule.forFeature([UserEntity, PasskeyCredentialEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_SECRET',
          'roxira_enterprise_super_secure_jwt_secret_key_2026',
        ),
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
    JwtAuthGuard,
    redisClientProvider,
  ],
  exports: [AuthService, WebAuthnService],
})
export class AuthModule {}
