import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './controllers/inventory.controller';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryService } from './services/inventory.service';

/**
 * ماژول جامع انبارداری سازمانی چند‌انباره و قیمت‌گذاری FIFO
 * (Multi-Warehouse FIFO Inventory).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (کنترل یکتایی SKU، هشدار کسری، مصرف FIFO، ارزش‌گذاری).
 * - Repository: تنها لایه با دسترسی مستقیم به جداول انبار و دسته‌های FIFO.
 *
 * جداول متصل: erp_warehouses، erp_stock_items و inventory_fifo_batches.
 * بدون هیچ import چرخه‌ای با سایر ماژول‌ها.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarehouseEntity,
      StockItemEntity,
      FifoBatchEntity,
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
