import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyModule } from '../currency/currency.module';
import { InvoicingController } from './controllers/invoicing.controller';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';

/**
 * ماژول صورتحساب مالیاتی هوشمند (Smart Invoicing).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (محاسبه مالیات ۹٪، جمع‌بندی، گردش وضعیت، چندارزی).
 * - Repository: تنها لایه با دسترسی مستقیم به پایگاه‌داده.
 *
 * بدون هیچ import چرخه‌ای (Circular Dependency) با سایر ماژول‌ها.
 */
@Module({
  imports: [TypeOrmModule.forFeature([InvoiceEntity]), CurrencyModule],
  controllers: [InvoicingController],
  providers: [InvoicingService, InvoicingRepository],
  exports: [InvoicingService],
})
export class InvoicingModule {}
