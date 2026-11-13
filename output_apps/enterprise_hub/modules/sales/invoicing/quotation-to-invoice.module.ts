import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { VatRateResolver } from '../../invoicing/services/vat-rate.resolver';
import { PartiesModule } from '../../parties/parties.module';
import { TenantsModule } from '../../tenants/tenants.module';
import { SalesQuotationLineEntity, SalesQuotationEntity } from '../entities/sales-quotation.entity';
import { SalesModule } from '../sales.module';
import { QuotationToInvoiceController } from './controllers/quotation-to-invoice.controller';
import { QuotationToInvoiceService } from './services/quotation-to-invoice.service';

/**
 * ماژول تبدیل پیش‌فاکتور به صورتحساب فروش (T104).
 * این ماژول به صورت لایه هماهنگ‌کننده روی SalesModule و InvoicingModule قرار می‌گیرد
 * تا بدون ایجاد وابستگی چرخه‌ای (Circular Dependency)، فرآیند تبدیل ۱-کلیکی را
 * به صورت ایدمپوتنت، با اعمال نرخ مالیاتی و بررسی تاریخ انقضا انجام دهد.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesQuotationEntity,
      SalesQuotationLineEntity,
      InvoiceEntity,
    ]),
    SalesModule,
    InvoicingModule,
    PartiesModule,
    TenantsModule,
  ],
  controllers: [QuotationToInvoiceController],
  providers: [
    QuotationToInvoiceService,
    VatRateResolver,
    StatutoryRepository,
    InvoicingRepository,
    TenantScope,
  ],
  exports: [QuotationToInvoiceService],
})
export class QuotationToInvoiceModule {}
