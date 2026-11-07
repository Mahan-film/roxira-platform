import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesModule } from '../sales.module';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { PostingRulesModule } from '../../posting_rules/posting-rules.module';
import { SalesReturnController } from './controllers/sales-return.controller';
import { SalesReturnService } from './services/sales-return.service';
import { SalesDeliveryRepository } from '../delivery/repositories/sales-delivery.repository';
import { SalesDeliveryLineEntity } from '../delivery/entities/sales-delivery.entity';
import { SalesDeliveryEntity } from '../delivery/entities/sales-delivery.entity';

/**
 * Returns module: creates RETURN invoices for sales delivery invoices.
 * 
 * Validates that delivery lines belong to the invoice, checks quantity constraints,
 * creates RETURN invoices through the existing invoicing path, posts stock receipt
 * at the original cost and posts COGS reversal.
 */
@Module({
  imports: [
    SalesModule,
    InvoicingModule,
    InventoryModule,
    PostingRulesModule,
    TypeOrmModule.forFeature([
      SalesDeliveryEntity,
      SalesDeliveryLineEntity,
    ]),
  ],
  controllers: [SalesReturnController],
  providers: [SalesReturnService, SalesDeliveryRepository],
  exports: [SalesReturnService],
})
export class SalesReturnModule {}
export { SalesReturnController } from './controllers/sales-return.controller';
export { SalesReturnService } from './services/sales-return.service';
export { CreateReturnDto, ReturnResponseDto } from './dto/sales-return.dto';
