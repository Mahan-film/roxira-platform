import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JWT_DEFAULT_EXPIRES_IN } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CrmController } from './controllers/crm.controller';
import { ContactMessageEntity } from './entities/contact-message.entity';
import { CrmLeadEntity } from './entities/crm-lead.entity';
import { CrmRepository } from './repositories/crm.repository';
import { CrmService } from './services/crm.service';

/**
 * ماژول جامع مدیریت ارتباط با مشتریان (Enterprise CRM) و پایپ‌لاین سرنخ‌ها.
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (یکتایی رایانامه، انتقال مرحله فروش، یادداشت،
 *   سوابق تماس و محاسبه آمار ریالی فرصت‌های باز/نرخ تبدیل).
 * - Repository: تنها لایه با دسترسی مستقیم به جداول CRM.
 *
 * احراز هویت: همان `JwtAuthGuard` و همان کلید امضای ماژول Auth بازاستفاده
 * می‌شود تا مسیرهای CRM فقط برای توکن تأییدشده باز شوند و شناسه مستأجر تنها از
 * پیلود JWT خوانده شود (Rule #4 - AGENTS.md). بدون هیچ import چرخه‌ای با سایر
 * ماژول‌ها (Rule #1 - AGENTS.md).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CrmLeadEntity, ContactMessageEntity]),
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
  controllers: [CrmController],
  providers: [CrmService, CrmRepository, JwtAuthGuard],
  exports: [CrmService],
})
export class CrmModule {}
