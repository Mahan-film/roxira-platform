import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JWT_DEFAULT_EXPIRES_IN } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountingModule } from '../accounting/accounting.module';
import { BankingModule } from '../banking/banking.module';
import { PartiesModule } from '../parties/parties.module';
import { PartiesRegistry } from './registry/parties.registry';
import { CrmModule } from '../crm/crm.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { ChequesModule } from '../cheques/cheques.module';
import { PACKAGE_QUEUE_NAME } from './constants/package-import.constants';
import { DataImportController } from './controllers/data-import.controller';
import { ImportMappingMemoryEntity } from './entities/import-mapping-memory.entity';
import { ImportMappingMemoryRepository } from './repositories/import-mapping-memory.repository';
import { ChunkedUploadService } from './services/chunked-upload.service';
import { MappingMemoryService } from './services/mapping-memory.service';
import { PackageOcrService } from './services/package-ocr.service';
import { PackageReconciliationService } from './services/package-reconciliation.service';
import { DataImportBatchItemEntity } from './entities/data-import-batch-item.entity';
import { DataImportBatchEntity } from './entities/data-import-batch.entity';
import { PackageImportProcessor } from './processors/package-import.processor';
import { AccountingAccountsRegistry } from './registry/accounting-accounts.registry';
import { AccountingJournalLinesRegistry } from './registry/accounting-journal-lines.registry';
import { AccountingOpeningBalancesRegistry } from './registry/accounting-opening-balances.registry';
import { BankStatementRegistry } from './registry/bank-statement.registry';
import { CrmActivitiesRegistry } from './registry/crm-activities.registry';
import { CrmLeadsRegistry } from './registry/crm-leads.registry';
import {
  ENTITY_IMPORT_ADAPTERS,
  EntityRegistryService,
} from './registry/entity-registry.service';
import { HrEmployeesRegistry } from './registry/hr-employees.registry';
import { InventoryItemsRegistry } from './registry/inventory-items.registry';
import { SalesInvoicesRegistry } from './registry/sales-invoices.registry';
import { DataImportBatchRepository } from './repositories/data-import-batch.repository';
import { DataImportRepository } from './repositories/data-import.repository';
import { DataImportService } from './services/data-import.service';
import { DailyImportQuotaService } from './services/daily-import-quota.service';
import { EntityImportService } from './services/entity-import.service';
import { OpenRouterMappingService } from './services/openrouter-mapping.service';
import { OpenRouterVisionService } from './services/openrouter-vision.service';
import { PackageAnalysisService } from './services/package-analysis.service';
import { PackageCommitService } from './services/package-commit.service';
import { PackageImportService } from './services/package-import.service';
import { PackageProgressService } from './services/package-progress.service';
import { PackageStoreService } from './services/package-store.service';
import { UploadStoreService } from './services/upload-store.service';
import { SepidarChequesFifoAdapter } from './migration/bak/sepidar-cheques-fifo.adapter';
import { TenantExportService } from './services/tenant-export.service';
import { TenantExportController } from './controllers/tenant-export.controller';
import { TenantExportRepository } from './repositories/tenant-export.repository';
import { SepidarMappingAdapter } from './migration/bak/sepidar-mapping.adapter';
import { HolooMappingAdapter } from './migration/bak/holoo-mapping.adapter';
import { SepidarPersistenceService } from './services/sepidar-persistence.service';
import { TenantScope } from '../access/services/tenant-scope';
import { BulkImportController } from './bulk/bulk-import.controller';
import { BulkImportProcessor } from './bulk/bulk-import.processor';
import { BulkImportRepository } from './bulk/bulk-import.repository';
import { BulkImportRunner } from './bulk/bulk-import.runner';
import { BulkImportService } from './bulk/bulk-import.service';
import { BulkPostService } from './bulk/bulk-post.service';
import { BULK_QUEUE_NAME, localStorageRoot, storageDriver } from './bulk/bulk.constants';
import { LocalObjectStore } from './bulk/storage/local-object-store';
import { OBJECT_STORE } from './bulk/storage/object-store';
import { S3ObjectStore, s3SettingsFromEnv } from './bulk/storage/s3-object-store';

/**
 * ماژول ورود داده با کمک هوش مصنوعی (AI-assisted data import).
 *
 * فاز ۱: رجیستری موجودیت‌ها (سرنخ CRM، کارمند، کالا، حساب دفتر کل، سطر
 * افتتاحیه) با تشخیص خودکار و undo. فاز بستهٔ دیتابیس: مهاجرت کل شرکت از
 * SQLite/SQL/ZIP با تحلیل ناهمزمان (BullMQ) و یک دستهٔ ورود برای undo.
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: مسیریابی HTTP + بارگذاری فایل + کنترل دسترسی.
 * - Service: تجزیه، تشخیص/نگاشت، تحلیل سلامت، درج گروهی و دسته‌های ورود.
 * - Repository: تنها لایه نوشتن (جداول دسته‌های ورود).
 */
@Module({
  imports: [
    ConfigModule,
    CrmModule,
    HrModule,
    InventoryModule,
    AccountingModule,
    InvoicingModule,
    BankingModule,
    PartiesModule,
    ChequesModule,
    BullModule.registerQueue({ name: PACKAGE_QUEUE_NAME }, { name: BULK_QUEUE_NAME }),
    TypeOrmModule.forFeature([
      DataImportBatchEntity,
      DataImportBatchItemEntity,
      ImportMappingMemoryEntity,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', ''),
        signOptions: {
          expiresIn: config.get<string>(
            'JWT_EXPIRES_IN',
            JWT_DEFAULT_EXPIRES_IN,
          ),
        },
      }),
    }),
  ],
  controllers: [DataImportController, BulkImportController, TenantExportController],
  providers: [
    DataImportService,
    DataImportRepository,
    EntityImportService,
    DataImportBatchRepository,
    DailyImportQuotaService,
    OpenRouterMappingService,
    OpenRouterVisionService,
    UploadStoreService,
    PackageStoreService,
    PackageProgressService,
    PackageAnalysisService,
    PackageCommitService,
    PackageImportService,
    PackageImportProcessor,
    ChunkedUploadService,
    PackageReconciliationService,
    PackageOcrService,
    MappingMemoryService,
    ImportMappingMemoryRepository,
    EntityRegistryService,
    CrmLeadsRegistry,
    HrEmployeesRegistry,
    InventoryItemsRegistry,
    AccountingAccountsRegistry,
    AccountingOpeningBalancesRegistry,
    AccountingJournalLinesRegistry,
    SalesInvoicesRegistry,
    CrmActivitiesRegistry,
    BankStatementRegistry,
    PartiesRegistry,
    {
      provide: ENTITY_IMPORT_ADAPTERS,
      useFactory: (
        crmLeads: CrmLeadsRegistry,
        hrEmployees: HrEmployeesRegistry,
        inventoryItems: InventoryItemsRegistry,
        accountingAccounts: AccountingAccountsRegistry,
        accountingOpeningBalances: AccountingOpeningBalancesRegistry,
        accountingJournalLines: AccountingJournalLinesRegistry,
        salesInvoices: SalesInvoicesRegistry,
        crmActivities: CrmActivitiesRegistry,
        bankStatement: BankStatementRegistry,
        parties: PartiesRegistry,
      ) => [
        crmLeads,
        hrEmployees,
        inventoryItems,
        accountingAccounts,
        accountingOpeningBalances,
        accountingJournalLines,
        salesInvoices,
        crmActivities,
        bankStatement,
        parties,
      ],
      inject: [
        CrmLeadsRegistry,
        HrEmployeesRegistry,
        InventoryItemsRegistry,
        AccountingAccountsRegistry,
        AccountingOpeningBalancesRegistry,
        AccountingJournalLinesRegistry,
        SalesInvoicesRegistry,
        CrmActivitiesRegistry,
        BankStatementRegistry,
        PartiesRegistry,
      ],
    },
    SepidarChequesFifoAdapter,
    SepidarMappingAdapter,
    HolooMappingAdapter,
    SepidarPersistenceService,
    JwtAuthGuard,
    TenantScope,
    BulkImportRepository,
    BulkImportRunner,
    BulkImportService,
    BulkPostService,
    BulkImportProcessor,
    TenantExportRepository,
    TenantExportService,
    {
      provide: OBJECT_STORE,
      // R2 (S3 API) in production; a folder on disk only for development. Settings come from the environment.
      useFactory: () => (storageDriver() === 's3' ? new S3ObjectStore(s3SettingsFromEnv()) : new LocalObjectStore(localStorageRoot())),
    },
  ],
  exports: [
    DataImportService,
    EntityImportService,
    SepidarChequesFifoAdapter,
    TenantExportRepository,
    TenantExportService,
    SepidarMappingAdapter,
    HolooMappingAdapter,
    SepidarPersistenceService,
  ],
})
export class DataImportModule {}
