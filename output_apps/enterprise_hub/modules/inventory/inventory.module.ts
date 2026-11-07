import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { TenantScope } from '../access/services/tenant-scope';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { SalesModule } from '../sales/sales.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './controllers/inventory.controller';
import { StockDocumentsController } from './controllers/stock-documents.controller';
import { StockReportsController } from './controllers/stock-reports.controller';
import { LandedCostController } from './purchasing/landed-cost.controller';
import { LandedCostService } from './purchasing/landed-cost.service';
import { LandedCostRepository } from './purchasing/landed-cost.repository';
import { PurchaseController } from './purchasing/purchase.controller';
import { PurchaseCycleService } from './purchasing/purchase-cycle.service';
import { PurchaseRepository } from './purchasing/purchase.repository';
import { SupplierInvoiceController } from './purchasing/supplier-invoice.controller';
import { SupplierInvoiceService } from './purchasing/supplier-invoice.service';
import { SupplierInvoiceRepository } from './purchasing/supplier-invoice.repository';
import { StoresController } from './controllers/stores.controller';
import { StockDocumentEntity, StockDocumentLineEntity } from './entities/stock-document.entity';
import { StoreEntity } from './entities/store.entity';
import { StockDocumentsRepository } from './repositories/stock-documents.repository';
import { OpeningBalanceController } from './controllers/opening-balance.controller';
import { OpeningBalanceService } from './services/opening-balance.service';
import { StockDocumentsService } from './services/stock-documents.service';
import { StockReportService } from './services/stock-report.service';
import { StoresService } from './services/stores.service';
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
    AccountingModule,
    PostingRulesModule,
    // رزرو فروش (#527 T1): سرویس دسترس‌پذیری فروش برای محاسبه موجودی آزاد. SalesModule چیزی از
    // انبارداری وارد نمی‌کند، پس چرخه‌ای ایجاد نمی‌شود.
    SalesModule,
    TypeOrmModule.forFeature([
      WarehouseEntity,
      StockItemEntity,
      FifoBatchEntity,
      StoreEntity,
      StockDocumentEntity,
      StockDocumentLineEntity,
    ]),
  ],
  controllers: [
    InventoryController,
    StoresController,
    StockDocumentsController,
    OpeningBalanceController,
    StockReportsController,
    PurchaseController,
    SupplierInvoiceController,
    LandedCostController,
  ],
  providers: [
    InventoryService,
    InventoryRepository,
    StoresService,
    StockDocumentsService,
    StockDocumentsRepository,
    OpeningBalanceService,
    StockReportService,
    PurchaseCycleService,
    PurchaseRepository,
    SupplierInvoiceService,
    SupplierInvoiceRepository,
    LandedCostService,
    LandedCostRepository,
    TenantScope,
  ],
  exports: [
    InventoryService,
    InventoryRepository,
    StockDocumentsService,
    StockDocumentsRepository,
    PurchaseCycleService,
    PurchaseRepository,
    SupplierInvoiceService,
    SupplierInvoiceRepository,
    LandedCostService,
    LandedCostRepository,
  ],
})
export class InventoryModule {}
