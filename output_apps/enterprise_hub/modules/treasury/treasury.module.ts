import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingModule } from '../accounting/accounting.module';
import { AGEING_ALLOCATIONS } from '../accounting/reports/ageing-allocations';
import { BankingModule } from '../banking/banking.module';
import { ChequesModule } from '../cheques/cheques.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { TreasuryController } from './controllers/treasury.controller';
import { TreasurySmsController } from './controllers/treasury-sms.controller';
import { TreasuryAllocationEntity } from './entities/treasury-allocation.entity';
import { TreasuryDocumentLineEntity } from './entities/treasury-document-line.entity';
import { TreasuryDocumentEntity } from './entities/treasury-document.entity';
import { TreasurySettingsEntity } from './entities/treasury-settings.entity';
import { TreasurySmsDraftEntity } from './entities/treasury-sms-draft.entity';
import { TreasuryLedgerPostingAdapter } from './posting/treasury-ledger-posting.adapter';
import { TREASURY_POSTING } from './posting/treasury-posting.port';
import { TreasuryRepository } from './repositories/treasury.repository';
import { TreasurySmsRepository } from './repositories/treasury-sms.repository';
import { TreasuryService } from './services/treasury.service';
import { TreasurySmsService } from './services/treasury-sms.service';

/**
 * Treasury: receipts and payments with settlement against invoices (cash boxes, transfers and POS
 * settlement follow in the next PRs). Reuses banking and cheques through their public services.
 *
 * Posting seam: swap `useClass` below for the posting_rules adapter when that module lands.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TreasuryDocumentEntity,
      TreasuryDocumentLineEntity,
      TreasuryAllocationEntity,
      TreasurySettingsEntity,
      TreasurySmsDraftEntity,
    ]),
    AccountingModule,
    BankingModule,
    ChequesModule,
    InvoicingModule,
  ],
  controllers: [TreasuryController, TreasurySmsController],
  providers: [
    TreasuryService,
    TreasuryRepository,
    TreasurySmsService,
    TreasurySmsRepository,
    TenantScope,
    { provide: TREASURY_POSTING, useClass: TreasuryLedgerPostingAdapter },
    // Ageing and the party statement settle invoices by these allocations (#237).
    { provide: AGEING_ALLOCATIONS, useExisting: TreasuryService },
  ],
  exports: [TreasuryService, TreasurySmsService],
})
export class TreasuryModule {}
