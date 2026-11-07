import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { SalesModule } from '../sales.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { PostingRulesModule } from '../../posting_rules/posting-rules.module';
import { SalesDeliveryController } from './controllers/sales-delivery.controller';
import { SalesDeliveryEntity, SalesDeliveryLineEntity } from './entities/sales-delivery.entity';
import { SalesDeliveryRepository } from './repositories/sales-delivery.repository';
import { SalesDeliveryService } from './services/sales-delivery.service';

/**
 * Delivery notes with partial delivery (#536 T1). Imports SalesModule (the order documents and
 * the one `SalesRepository.runInTransaction` everything runs in), InventoryModule (FIFO issue,
 * stock documents, account resolution) and PostingRulesModule (the COGS voucher). Its own module
 * on purpose: InventoryModule already imports SalesModule, so SalesModule must never import
 * InventoryModule, and this module sits on top of both.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SalesDeliveryEntity, SalesDeliveryLineEntity]),
    SalesModule,
    InventoryModule,
    PostingRulesModule,
  ],
  controllers: [SalesDeliveryController],
  providers: [SalesDeliveryService, SalesDeliveryRepository, TenantScope],
})
export class SalesDeliveryModule {}
