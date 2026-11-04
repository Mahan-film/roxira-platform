import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingModule } from '../accounting/accounting.module';
import { CrmModule } from '../crm/crm.module';
import { CurrencyModule } from '../currency/currency.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SUITE_EVENTS_QUEUE } from './constants/suite-events.constants';
import { PosSalesController } from './controllers/pos-sales.controller';
import { PosSaleService } from './services/pos-sale.service';
import { InvoicingController } from './controllers/invoicing.controller';
import { InvoiceEntity } from './entities/invoice.entity';
import { SuiteEventsProcessor } from './processors/suite-events.processor';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';

/**
 * ماژول صورتحساب مالیاتی هوشمند (Smart Invoicing).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (محاسبه مالیات ارزش افزوده هر سطر، جمع‌بندی، گردش وضعیت، چندارزی).
 * - Repository: تنها لایه با دسترسی مستقیم به پایگاه‌داده.
 * - Processor: هم‌آمیزی ناهمزمان با انبار و دفتر کل از طریق صف `suite-events`.
 *
 * بدون هیچ import چرخه‌ای (Circular Dependency) با سایر ماژول‌ها.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceEntity]),
    CurrencyModule,
    CrmModule,
    InventoryModule,
    AccountingModule,
    TenantsModule,
    BullModule.registerQueue({ name: SUITE_EVENTS_QUEUE }),
  ],
  controllers: [InvoicingController, PosSalesController],
  providers: [
    InvoicingService,
    InvoicingRepository,
    InvoicePostingService,
    PosSaleService,
    SuiteEventsProcessor,
  ],
  exports: [InvoicingService],
})
export class InvoicingModule {}
