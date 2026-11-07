import { Module } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { InventoryModule } from '../../inventory/inventory.module';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { PostingRulesModule } from '../../posting_rules/posting-rules.module';
import { SalesReturnController } from './controllers/sales-return.controller';
import { SalesReturnRepository } from './repositories/sales-return.repository';
import { SalesReturnService } from './services/sales-return.service';

/**
 * Partial returns of delivery invoices (#565 T1 slice 5). Imports InvoicingModule (the invoice
 * service and repository the RETURN invoice is created through), InventoryModule (stock back at
 * the delivery cost, account resolution) and PostingRulesModule (the COGS reversal voucher).
 */
@Module({
  imports: [InvoicingModule, InventoryModule, PostingRulesModule],
  controllers: [SalesReturnController],
  providers: [SalesReturnService, SalesReturnRepository, TenantScope],
  exports: [SalesReturnService],
})
export class SalesReturnModule {}
