import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TenantScope } from '../access/services/tenant-scope';
import { ApprovalsController } from './controllers/approvals.controller';
import { APPROVAL_ESCALATION_QUEUE } from './constants/approvals.constants';
import { ApprovalEscalationProcessor } from './processors/approval-escalation.processor';
import { ApprovalsRepository } from './repositories/approvals.repository';
import { ApprovalsService } from './services/approvals.service';

@Module({
  imports: [
    AccessModule,
    BullModule.registerQueue({
      name: APPROVAL_ESCALATION_QUEUE,
    }),
  ],
  controllers: [ApprovalsController],
  providers: [TenantScope, ApprovalsRepository, ApprovalsService, ApprovalEscalationProcessor],
  exports: [ApprovalsService, ApprovalsRepository],
})
export class ApprovalsModule {}
