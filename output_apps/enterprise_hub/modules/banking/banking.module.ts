import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingModule } from '../accounting/accounting.module';
import { BankingController } from './controllers/banking.controller';
import { BankAccountEntity } from './entities/bank-account.entity';
import { BankStatementLineEntity } from './entities/bank-statement-line.entity';
import { BankingRepository } from './repositories/banking.repository';
import { BankingService } from './services/banking.service';

/**
 * ماژول حساب‌های بانکی و مغایرت‌گیری بانکی (فاز ۲ سوئیت کسب‌وکار).
 *
 * Layer Boundaries (AGENTS.md):
 * - Controller: مسیریابی HTTP + DTO.
 * - Service: تطبیق خودکار/دستی، ساخت سند، خلاصه مغایرت.
 * - Repository: تنها لایه دسترسی به fin_bank_accounts و fin_bank_statement_lines.
 *
 * فقط به AccountingModule وابسته است (بدون چرخه)؛ DataImportModule برای ورود
 * صورتحساب از BankingService استفاده می‌کند.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BankAccountEntity, BankStatementLineEntity]),
    AccountingModule,
  ],
  controllers: [BankingController],
  providers: [BankingService, BankingRepository],
  exports: [BankingService],
})
export class BankingModule {}
