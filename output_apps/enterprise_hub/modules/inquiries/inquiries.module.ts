import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from '../auth/services/mail.service';
import { InquiriesController } from './controllers/inquiries.controller';
import { EnterpriseInquiryEntity } from './entities/enterprise-inquiry.entity';
import { InquiriesRepository } from './repositories/inquiries.repository';
import { InquiriesService } from './services/inquiries.service';

/**
 * ماژول پیش‌ثبت‌نام و درخواست همکاری سازمانی (Enterprise Inquiries).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (پاک‌سازی/اعتبارسنجی، ثبت درخواست عمومی و
 *   اطلاع‌رسانی به فروش).
 * - Repository: تنها لایه با دسترسی مستقیم به جدول `enterprise_inquiries`.
 *
 * بدون هیچ import چرخه‌ای با سایر ماژول‌ها (Rule #1 - AGENTS.md).
 */
@Module({
  imports: [TypeOrmModule.forFeature([EnterpriseInquiryEntity])],
  controllers: [InquiriesController],
  providers: [InquiriesService, InquiriesRepository, MailService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
