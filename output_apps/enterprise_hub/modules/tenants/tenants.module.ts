import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './entities/tenant.entity';
import { TenantsRepository } from './repositories/tenants.repository';
import { TenantsService } from './services/tenants.service';

/**
 * ماژول سازمان‌ها (مستأجرها).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Service: منطق کسب‌وکار (ساخت اسلاگ یکتا و ایجاد/بازیابی مستأجر).
 * - Repository: تنها لایه با دسترسی مستقیم به جدول tenants.
 *
 * بدون هیچ import چرخه‌ای با سایر ماژول‌ها: این ماژول به هیچ ماژول دیگری
 * وابسته نیست و فقط برای مصرف‌کننده‌هایی مانند AuthModule سرویس صادر می‌کند.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  providers: [TenantsService, TenantsRepository],
  exports: [TenantsService],
})
export class TenantsModule {}
