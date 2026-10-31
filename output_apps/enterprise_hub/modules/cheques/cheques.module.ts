import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingModule } from '../accounting/accounting.module';
import { ChequesController } from './controllers/cheques.controller';
import { ChequeEventEntity } from './entities/cheque-event.entity';
import { ChequeEntity } from './entities/cheque.entity';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequesService } from './services/cheques.service';

/**
 * Received and issued cheques with lifecycle and ledger postings.
 *
 * Depends only on AccountingModule (a client of `createJournalEntry`; no cycle).
 * Sayad numbers are stored as entered; there is no Sayad network integration.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ChequeEntity, ChequeEventEntity]), AccountingModule],
  controllers: [ChequesController],
  providers: [ChequesService, ChequesRepository],
  exports: [ChequesService],
})
export class ChequesModule {}
