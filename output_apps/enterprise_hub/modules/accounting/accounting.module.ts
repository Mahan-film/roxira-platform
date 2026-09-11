import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyModule } from '../currency/currency.module';
import { AccountingController } from './controllers/accounting.controller';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

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
    ]),
    CurrencyModule,
  ],
  controllers: [AccountingController],
  providers: [AccountingService, AccountingRepository],
  exports: [AccountingService],
})
export class AccountingModule {}