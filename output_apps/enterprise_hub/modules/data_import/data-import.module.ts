import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JWT_DEFAULT_EXPIRES_IN } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountingModule } from '../accounting/accounting.module';
import { CrmModule } from '../crm/crm.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DataImportController } from './controllers/data-import.controller';
import { DataImportBatchItemEntity } from './entities/data-import-batch-item.entity';
import { DataImportBatchEntity } from './entities/data-import-batch.entity';
import { AccountingAccountsRegistry } from './registry/accounting-accounts.registry';
import { AccountingOpeningBalancesRegistry } from './registry/accounting-opening-balances.registry';
import { CrmLeadsRegistry } from './registry/crm-leads.registry';
import {
  ENTITY_IMPORT_ADAPTERS,
  EntityRegistryService,
} from './registry/entity-registry.service';
import { HrEmployeesRegistry } from './registry/hr-employees.registry';
import { InventoryItemsRegistry } from './registry/inventory-items.registry';
import { DataImportBatchRepository } from './repositories/data-import-batch.repository';
import { DataImportRepository } from './repositories/data-import.repository';
import { DataImportService } from './services/data-import.service';
import { EntityImportService } from './services/entity-import.service';
import { OpenRouterMappingService } from './services/openrouter-mapping.service';
import { OpenRouterVisionService } from './services/openrouter-vision.service';
import { UploadStoreService } from './services/upload-store.service';

/**
 * ماژول ورود داده با کمک هوش مصنوعی (AI-assisted data import).
 *
 * فاز ۱: رجیستری موجودیت‌ها (سرنخ CRM، کارمند، کالا، حساب دفتر کل و سطر
 * افتتاحیه) با تشخیص خودکار و undo. هر موجودیت یک آداپتور دارد که درج/حذف را
 * تنها از طریق سرویس/ریپازیتوری ماژول مالک انجام می‌دهد (Rule #1 و #3).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: مسیریابی HTTP + بارگذاری فایل + کنترل دسترسی.
 * - Service: تجزیه CSV/XLSX/PDF متنی و استخراج جدول از تصویر (مدل بینایی)،
 *   نگاشت ستون‌ها، اعتبارسنجی، درج گروهی و دسته‌های ورود.
 * - Repository: تنها لایه نوشتن (CRM و جداول دسته‌های ورود).
 */
@Module({
  imports: [
    ConfigModule,
    CrmModule,
    HrModule,
    InventoryModule,
    AccountingModule,
    TypeOrmModule.forFeature([
      DataImportBatchEntity,
      DataImportBatchItemEntity,
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
  controllers: [DataImportController],
  providers: [
    DataImportService,
    DataImportRepository,
    EntityImportService,
    DataImportBatchRepository,
    OpenRouterMappingService,
    OpenRouterVisionService,
    UploadStoreService,
    EntityRegistryService,
    CrmLeadsRegistry,
    HrEmployeesRegistry,
    InventoryItemsRegistry,
    AccountingAccountsRegistry,
    AccountingOpeningBalancesRegistry,
    {
      provide: ENTITY_IMPORT_ADAPTERS,
      useFactory: (
        crmLeads: CrmLeadsRegistry,
        hrEmployees: HrEmployeesRegistry,
        inventoryItems: InventoryItemsRegistry,
        accountingAccounts: AccountingAccountsRegistry,
        accountingOpeningBalances: AccountingOpeningBalancesRegistry,
      ) => [
        crmLeads,
        hrEmployees,
        inventoryItems,
        accountingAccounts,
        accountingOpeningBalances,
      ],
      inject: [
        CrmLeadsRegistry,
        HrEmployeesRegistry,
        InventoryItemsRegistry,
        AccountingAccountsRegistry,
        AccountingOpeningBalancesRegistry,
      ],
    },
    JwtAuthGuard,
  ],
  exports: [DataImportService, EntityImportService],
})
export class DataImportModule {}
