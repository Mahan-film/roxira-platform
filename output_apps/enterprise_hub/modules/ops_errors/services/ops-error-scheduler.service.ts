import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  OPS_ERROR_ALERTS_QUEUE,
  OPS_ERROR_DIGEST_CRON,
  OPS_ERROR_DIGEST_JOB,
  OPS_ERROR_SCAN_EVERY_MS,
  OPS_ERROR_SCAN_JOB,
} from '../constants/ops-errors.constants';

/** Registers the two repeatable jobs once per process start (skipped in tests). */
@Injectable()
export class OpsErrorSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(OpsErrorSchedulerService.name);

  constructor(@Optional() @InjectQueue(OPS_ERROR_ALERTS_QUEUE) private readonly queue?: Queue) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !this.queue) return;
    const opts = { removeOnComplete: 10, removeOnFail: 10 };
    await this.queue
      .add(OPS_ERROR_SCAN_JOB, {}, { ...opts, repeat: { every: OPS_ERROR_SCAN_EVERY_MS }, jobId: 'ops-error-scan' })
      .catch((e) => this.logger.warn(`scan schedule failed: ${(e as Error).message}`));
    await this.queue
      .add(OPS_ERROR_DIGEST_JOB, {}, { ...opts, repeat: { pattern: OPS_ERROR_DIGEST_CRON }, jobId: 'ops-error-digest' })
      .catch((e) => this.logger.warn(`digest schedule failed: ${(e as Error).message}`));
  }
}
