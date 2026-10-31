import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyModule } from '../currency/currency.module';
import { AccountingController } from './controllers/accounting.controller';
import { FiscalYearController } from './controllers/fiscal-year.controller';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { FiscalYearEntity } from './entities/fiscal-year.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FiscalYearService } from './services/fiscal-year.service';

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
    ]),
    CurrencyModule,
  ],
  controllers: [AccountingController, FiscalYearController],
  providers: [
    AccountingService,
    AccountingRepository,
    ChartTemplateService,
    FiscalYearRepository,
    FiscalYearService,
    LedgerReportRepository,
  ],
  exports: [AccountingService],
})
export class AccountingModule {}