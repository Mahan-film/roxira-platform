import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingModule } from '../accounting/accounting.module';
import { CrmModule } from '../crm/crm.module';
import { CurrencyModule } from '../currency/currency.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { PartiesModule } from '../parties/parties.module';
import { TenantScope } from '../access/services/tenant-scope';
import { StatutoryParameterEntity } from '../hr/statutory/statutory-parameter.entity';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { TenantsModule } from '../tenants/tenants.module';
import { SUITE_EVENTS_QUEUE } from './constants/suite-events.constants';
import { PosSalesController } from './controllers/pos-sales.controller';
import { PosSaleService } from './services/pos-sale.service';
import { InvoicingController } from './controllers/invoicing.controller';
import { SalesReportController } from './controllers/sales-report.controller';
import { PurchasesReportController } from './controllers/purchases-report.controller';
import { GrossProfitReportController } from './controllers/gross-profit-report.controller';
import { InvoiceEntity } from './entities/invoice.entity';
import { PrintTemplateEntity } from './entities/print-template.entity';
import { SuiteEventsProcessor } from './processors/suite-events.processor';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { PrintTemplateRepository } from './repositories/print-template.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';
import { PrintTemplateService } from './services/print-template.service';
import { PrintTemplateController } from './controllers/print-template.controller';
import { SalesReportService } from './services/sales-report.service';
import { PurchasesReportService } from './services/purchases-report.service';
import { GrossProfitReportService } from './services/gross-profit-report.service';
import { VatRateResolver } from './services/vat-rate.resolver';

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
    TypeOrmModule.forFeature([InvoiceEntity, StatutoryParameterEntity, PrintTemplateEntity]),
    CurrencyModule,
    CrmModule,
    InventoryModule,
    AccountingModule,
    PostingRulesModule,
    TenantsModule,
    PartiesModule,
    BullModule.registerQueue({ name: SUITE_EVENTS_QUEUE }),
  ],
  controllers: [
    InvoicingController,
    PosSalesController,
    SalesReportController,
    PurchasesReportController,
    GrossProfitReportController,
    PrintTemplateController,
  ],
  providers: [
    InvoicingService,
    InvoicingRepository,
    InvoicePostingService,
    PosSaleService,
    SuiteEventsProcessor,
    // VAT-01: the general VAT rate comes from the statutory store, read-only here.
    VatRateResolver,
    StatutoryRepository,
    TenantScope,
    SalesReportService,
    PurchasesReportService,
    GrossProfitReportService,
    PrintTemplateService,
    PrintTemplateRepository,
  ],
  exports: [InvoicingService, InvoicingRepository, PrintTemplateService, PrintTemplateRepository],
})
export class InvoicingModule {}
