import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { BankingModule } from '../banking/banking.module';
import { ChequesController } from './controllers/cheques.controller';
import { ChequeEventEntity } from './entities/cheque-event.entity';
import { ChequeEntity } from './entities/cheque.entity';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequeReconService } from './services/cheque-recon.service';
import { ChequesService } from './services/cheques.service';
import { ChequeMaturityReportService } from './services/cheque-maturity-report.service';

/**
 * Received and issued cheques with lifecycle and ledger postings.
 *
 * Depends on AccountingModule (a client of `createJournalEntry`) and BankingModule (its exported
 * `BankingService`, for bank reconciliation of cleared cheques); neither imports this module, so no cycle.
 * Sayad numbers are stored as entered; there is no Sayad network integration.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ChequeEntity, ChequeEventEntity]), AccountingModule, BankingModule, PostingRulesModule],
  controllers: [ChequesController],
  providers: [ChequesService, ChequeReconService, ChequesRepository, ChequeMaturityReportService, TenantScope],
  exports: [ChequesService, ChequeMaturityReportService],
})
export class ChequesModule {}
