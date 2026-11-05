import { AccessModule } from '../access/access.module';
import { FixedAssetController } from './controllers/fixed-asset.controller';
import { DepreciationLineEntity, FixedAssetEntity } from './entities/fixed-asset.entity';
import { FixedAssetRepository } from './repositories/fixed-asset.repository';
import { FIXED_ASSET_POSTING, FixedAssetPosting, FixedAssetService } from './services/fixed-asset.service';
import { PETTY_CASH_POSTING, PettyCashPosting } from './services/petty-cash.service';
import { ModuleRef } from '@nestjs/core';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { DimensionController } from './controllers/dimension.controller';
import { DimensionEntity } from './entities/dimension.entity';
import { DimensionRepository } from './repositories/dimension.repository';
import { DimensionService } from './services/dimension.service';
import { TenantScope } from '../access/services/tenant-scope';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyModule } from '../currency/currency.module';
import { AccountingController } from './controllers/accounting.controller';
import { FiscalYearController } from './controllers/fiscal-year.controller';
import { PettyCashController } from './controllers/petty-cash.controller';
import { ReportsController } from './controllers/reports.controller';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { FiscalYearEntity } from './entities/fiscal-year.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { PettyCashFundEntity, PettyCashTransactionEntity } from './entities/petty-cash.entity';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { PettyCashRepository } from './repositories/petty-cash.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { CostCentreReportService } from './services/cost-centre-report.service';
import { FinancialReportsService } from './services/financial-reports.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { PettyCashService } from './services/petty-cash.service';
import { ReportExportService } from './services/report-export.service';

/**
 * ماژول حسابداری دوطرفه و دفتر روزنامه سازمانی
 * (Double-Entry General Ledger).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (کنترل تراز سند، تراز آزمایشی، گردش حساب).
 * - Repository: تنها لایه با دسترسی مستقیم به جداول مالی.
 *
 * جداول متصل: fin_chart_of_accounts، fin_journal_entries و
 * fin_journal_entry_lines. بدون هیچ import چرخه‌ای با سایر ماژول‌ها.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChartOfAccountEntity,
      JournalEntryEntity,
      JournalEntryLineEntity,
      PeriodLockEntity,
      FiscalYearEntity,
      DimensionEntity,
      FixedAssetEntity,
      DepreciationLineEntity,
      PettyCashFundEntity,
      PettyCashTransactionEntity,
    ]),
    CurrencyModule,
    AccessModule,
  ],
  controllers: [AccountingController, DimensionController, FixedAssetController, FiscalYearController, PettyCashController, ReportsController],
  providers: [
    AccountingService,
    AccountingRepository,
    DimensionRepository,
    DimensionService,
    TenantScope,
    FixedAssetRepository,
    FixedAssetService,
    // PostingRulesModule imports AccountingModule, so importing it here would be a cycle: the engine
    // is resolved lazily from the application container at call time instead.
    {
      provide: FIXED_ASSET_POSTING,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): FixedAssetPosting => ({
        post: (...args) => ref.get(PostingRulesService, { strict: false }).post(...args),
      }),
    },
    {
      provide: PETTY_CASH_POSTING,
      useExisting: FIXED_ASSET_POSTING,
    },
    ChartTemplateService,
    CostCentreReportService,
    FinancialReportsService,
    FiscalYearRepository,
    FiscalYearService,
    LedgerReportRepository,
    PettyCashRepository,
    PettyCashService,
    ReportExportService,
  ],
  exports: [AccountingService, FinancialReportsService],
})
export class AccountingModule {}