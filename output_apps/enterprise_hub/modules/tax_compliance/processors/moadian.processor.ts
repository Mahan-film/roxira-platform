import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  MOADIAN_POLL_JOB,
  MOADIAN_QUEUE,
  MOADIAN_SEND_JOB,
  MOADIAN_SYNC_STATUS_JOB,
} from '../constants/moadian.constants';
import { MoadianJobData, MoadianJobOutcome, MoadianService } from '../services/moadian.service';

/**
 * Worker صف `moadian`: ارسال بسته و استعلام وضعیت به‌صورت ناهمزمان
 * (Rule #5 - AGENTS.md). بدون tenantId/submissionId معتبر کاری انجام نمی‌شود.
 */
@Processor(MOADIAN_QUEUE)
export class MoadianProcessor extends WorkerHost {
  private readonly logger = new Logger(MoadianProcessor.name);

  constructor(private readonly moadianService: MoadianService) {
    super();
  }

  async process(job: Job<MoadianJobData>): Promise<{ outcome: MoadianJobOutcome | 'rejected' }> {
    if (job.name === MOADIAN_SYNC_STATUS_JOB) {
      await this.moadianService.syncNonFinalSubmissions(job.data?.tenantId);
      return { outcome: 'done' };
    }

    const { tenantId, submissionId, checkExistingFirst } = job.data ?? ({} as MoadianJobData);
    if (
      typeof tenantId !== 'string' ||
      tenantId.trim().length === 0 ||
      typeof submissionId !== 'string' ||
      submissionId.trim().length === 0
    ) {
      this.logger.error('Moadian job rejected: payload is missing tenantId/submissionId.');
      return { outcome: 'rejected' };
    }
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);

    switch (job.name) {
      case MOADIAN_SEND_JOB:
        return {
          outcome: await this.moadianService.processSend(
            {
              tenantId,
              submissionId,
              ...(checkExistingFirst ? { checkExistingFirst: true } : {}),
            },
            isFinalAttempt,
            job.attemptsMade,
          ),
        };
      case MOADIAN_POLL_JOB:
        return { outcome: await this.moadianService.processPoll({ tenantId, submissionId }) };
      default:
        this.logger.warn(`Unknown moadian job received: ${job.name}`);
        return { outcome: 'rejected' };
    }
  }
}
