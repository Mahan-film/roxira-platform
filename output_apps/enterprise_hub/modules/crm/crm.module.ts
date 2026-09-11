import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
 * جداول متصل: crm_leads و contact_messages. بدون هیچ import چرخه‌ای با
 * سایر ماژول‌ها (Rule #1 - AGENTS.md).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CrmLeadEntity, ContactMessageEntity]),
  ],
  controllers: [CrmController],
  providers: [CrmService, CrmRepository],
  exports: [CrmService],
})
export class CrmModule {}
