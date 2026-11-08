import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ApprovalsHttpHandler } from './approvals.routes';
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
  controllers: [ApprovalsHttpHandler],
  providers: [ApprovalsRepository, ApprovalsService, ApprovalEscalationProcessor],
  exports: [ApprovalsService, ApprovalsRepository],
})
export class ApprovalsModule {}
