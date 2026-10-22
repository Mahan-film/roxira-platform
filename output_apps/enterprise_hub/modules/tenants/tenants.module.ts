import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JWT_DEFAULT_EXPIRES_IN } from '../auth/constants/auth.constants';
import { UserEntity } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthRepository } from '../auth/repositories/auth.repository';
import { TenantsController } from './controllers/tenants.controller';
import { TenantEntity } from './entities/tenant.entity';
import { TenantsRepository } from './repositories/tenants.repository';
import { TenantsService } from './services/tenants.service';

/**
 * ماژول سازمان‌ها (مستأجرها).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: مسیریابی سازمان جاری و مدیریت اعضا.
 * - Service: منطق کسب‌وکار (ساخت اسلاگ یکتا، مدیریت اعضا).
 * - Repository: تنها لایه با دسترسی مستقیم به جدول tenants.
 *
 * برای مدیریت اعضا، همان `AuthRepository` ماژول Auth به‌صورت مستقیم اینجا
 * ارائه می‌شود (بدون import ماژول Auth) تا از وابستگی چرخه‌ای Auth ↔ Tenants
 * پرهیز شود؛ جدول users تنها از طریق Repository قابل دسترسی است.
 *
 * احراز هویت با همان `JwtAuthGuard` و کلید امضای ماژول Auth بازاستفاده می‌شود
 * (مطابق CrmModule) و شناسه مستأجر تنها از پیلود JWT خوانده می‌شود (Rule #4).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity, UserEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', ''),
        signOptions: {
          expiresIn: config.get<string>(
            'JWT_EXPIRES_IN',
            JWT_DEFAULT_EXPIRES_IN,
          ),
        },
      }),
    }),
  ],
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository, AuthRepository, JwtAuthGuard],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
