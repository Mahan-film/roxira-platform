import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmModule } from '../crm/crm.module';
import { CurrencyModule } from '../currency/currency.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TenantsModule } from '../tenants/tenants.module';
import { InvoicingController } from './controllers/invoicing.controller';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';

/**
 * ماژول صورتحساب مالیاتی هوشمند (Smart Invoicing).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (محاسبه مالیات ارزش افزوده هر سطر، جمع‌بندی، گردش وضعیت، چندارزی).
 * - Repository: تنها لایه با دسترسی مستقیم به پایگاه‌داده.
 *
 * بدون هیچ import چرخه‌ای (Circular Dependency) با سایر ماژول‌ها.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceEntity]),
    CurrencyModule,
    CrmModule,
    InventoryModule,
    TenantsModule,
  ],
  controllers: [InvoicingController],
  providers: [InvoicingService, InvoicingRepository],
  exports: [InvoicingService],
})
export class InvoicingModule {}
