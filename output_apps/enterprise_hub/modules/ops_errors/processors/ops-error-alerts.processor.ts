import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  OPS_ERROR_ALERTS_QUEUE,
  OPS_ERROR_DIGEST_JOB,
  OPS_ERROR_SCAN_JOB,
} from '../constants/ops-errors.constants';
import { OpsErrorAlertService } from '../services/ops-error-alert.service';

/** Worker for the repeatable `scan` (every 5 min) and `digest` (daily) jobs. */
@Processor(OPS_ERROR_ALERTS_QUEUE)
export class OpsErrorAlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(OpsErrorAlertsProcessor.name);

  constructor(private readonly alerts: OpsErrorAlertService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === OPS_ERROR_SCAN_JOB) return { sent: await this.alerts.scan() };
    if (job.name === OPS_ERROR_DIGEST_JOB) return this.alerts.digest();
    this.logger.warn(`Unknown ops-error-alerts job: ${job.name}`);
    return null;
  }
}
