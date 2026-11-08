import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  APPROVAL_ESCALATE_REQUEST_JOB,
  APPROVAL_ESCALATION_QUEUE,
  APPROVAL_ESCALATION_RUN_JOB,
} from '../constants/approvals.constants';
import { ApprovalsService } from '../services/approvals.service';

export interface EscalateRequestJobData {
  tenantId: string;
  requestId: string;
  stepOrder?: number;
}

export interface RunDueEscalationsJobData {
  tenantId: string;
}

@Processor(APPROVAL_ESCALATION_QUEUE)
export class ApprovalEscalationProcessor extends WorkerHost {
  private readonly logger = new Logger(ApprovalEscalationProcessor.name);

  constructor(private readonly approvals: ApprovalsService) {
    super();
  }

  async process(
    job: Job<EscalateRequestJobData | RunDueEscalationsJobData>,
  ): Promise<{ escalated: number }> {
    if (job.name === APPROVAL_ESCALATE_REQUEST_JOB) {
      const data = job.data as EscalateRequestJobData;
      if (!data?.tenantId || !data?.requestId) {
        this.logger.warn('Missing tenantId or requestId in escalate-approval-request job');
        return { escalated: 0 };
      }
      const didEscalate = await this.approvals.escalateRequestIfDue(data.tenantId, data.requestId);
      return { escalated: didEscalate ? 1 : 0 };
    }

    if (job.name === APPROVAL_ESCALATION_RUN_JOB) {
      const data = job.data as RunDueEscalationsJobData;
      if (!data?.tenantId) {
        this.logger.warn('Missing tenantId in run-due-approval-escalations job');
        return { escalated: 0 };
      }
      const res = await this.approvals.runDueEscalations(data.tenantId);
      return { escalated: res.escalated };
    }

    this.logger.warn(`Unknown job on ${APPROVAL_ESCALATION_QUEUE}: ${job.name}`);
    return { escalated: 0 };
  }
}
