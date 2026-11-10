import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { BankingController } from './controllers/banking.controller';
import { CashBoxController } from './controllers/cash-box.controller';
import { BankAccountEntity } from './entities/bank-account.entity';
import { BankStatementLineEntity } from './entities/bank-statement-line.entity';
import { CashBoxEntity } from './entities/cash-box.entity';
import { PosSettlementEntity } from './entities/pos-settlement.entity';
import { BankingRepository } from './repositories/banking.repository';
import { ReconController } from './recon/recon.controller';
import { ReconRepository } from './recon/recon.repository';
import { ReconService } from './recon/recon.service';
import { BankingService } from './services/banking.service';
import { CashBoxService } from './services/cash-box.service';

/**
 * ماژول حساب‌های بانکی، صندوق‌ها، انتقال وجه و مغایرت‌گیری بانکی.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankAccountEntity,
      BankStatementLineEntity,
      CashBoxEntity,
      PosSettlementEntity,
    ]),
    AccountingModule,
    PostingRulesModule,
  ],
  controllers: [BankingController, ReconController, CashBoxController],
  providers: [
    TenantScope,
    BankingService,
    BankingRepository,
    CashBoxService,
    ReconService,
    ReconRepository,
  ],
  exports: [BankingService, CashBoxService],
})
export class BankingModule {}
