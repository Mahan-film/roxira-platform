import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { VatRateResolver } from '../../invoicing/services/vat-rate.resolver';
import { TenantsModule } from '../../tenants/tenants.module';
import { SalesModule } from '../sales.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { PostingRulesModule } from '../../posting_rules/posting-rules.module';
import { SalesDeliveryController } from './controllers/sales-delivery.controller';
import { SalesDeliveryEntity, SalesDeliveryLineEntity } from './entities/sales-delivery.entity';
import { SalesInvoiceDeliveryLineEntity } from './entities/sales-invoice-delivery-line.entity';
import { SalesDeliveryRepository } from './repositories/sales-delivery.repository';
import { SalesInvoiceDeliveryRepository } from './repositories/sales-invoice-delivery.repository';
import { SalesDeliveryService } from './services/sales-delivery.service';
import { SalesInvoiceFromDeliveryService } from './services/sales-invoice-from-delivery.service';

/**
 * Delivery notes with partial delivery (#536 T1) and invoicing from deliveries (#563 T1 slice 4).
 * Imports SalesModule (the order documents and the one `SalesRepository.runInTransaction`
 * everything runs in), InventoryModule (FIFO issue, stock documents, account resolution),
 * PostingRulesModule (the COGS voucher), InvoicingModule (the invoice service the invoice is
 * created through) and TenantsModule (the seller name). Its own module on purpose:
 * InventoryModule already imports SalesModule, so SalesModule must never import
 * InventoryModule, and this module sits on top of both.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesDeliveryEntity,
      SalesDeliveryLineEntity,
      SalesInvoiceDeliveryLineEntity,
      InvoiceEntity,
    ]),
    SalesModule,
    InventoryModule,
    PostingRulesModule,
    InvoicingModule,
    TenantsModule,
  ],
  controllers: [SalesDeliveryController],
  providers: [
    SalesDeliveryService,
    SalesDeliveryRepository,
    SalesInvoiceFromDeliveryService,
    SalesInvoiceDeliveryRepository,
    // VAT-01: the general VAT rate of the invoice date comes from the statutory store, read-only.
    VatRateResolver,
    StatutoryRepository,
    InvoicingRepository,
    TenantScope,
  ],
})
export class SalesDeliveryModule {}
