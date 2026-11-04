import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BulkImportRunner } from './bulk-import.runner';
import { BulkImportService } from './bulk-import.service';
import { BulkPostService, BulkPostTable } from './bulk-post.service';
import { BULK_CLEANUP_JOB, BULK_SWEEP_JOB, BULK_POST_JOB, BULK_QUEUE_NAME, BULK_RUN_JOB } from './bulk.constants';

/**
 * Worker for the bulk queue. One file at a time per process (concurrency 1) so memory stays predictable;
 * the long lock lets a multi-hour job keep its lease while it awaits the database between batches.
 */
@Processor(BULK_QUEUE_NAME, { concurrency: 1, lockDuration: 120_000, stalledInterval: 60_000 })
export class BulkImportProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkImportProcessor.name);

  constructor(
    private readonly runner: BulkImportRunner,
    private readonly post: BulkPostService,
    private readonly service: BulkImportService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === BULK_SWEEP_JOB) return { swept: await this.service.sweep() };
    const { tenantId, jobId } = job.data as { tenantId?: string; jobId?: string };
    if (!tenantId || !jobId) {
      this.logger.error('Bulk job rejected: missing tenantId/jobId.');
      return { ok: false };
    }
    if (job.name === BULK_RUN_JOB) {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      return { outcome: await this.runner.run(tenantId, jobId, { finalAttempt }) };
    }
    if (job.name === BULK_POST_JOB) {
      const data = job.data as { tables: BulkPostTable[]; batchId: string };
      await this.post.post(tenantId, jobId, data.tables, data.batchId);
      return { ok: true };
    }
    if (job.name === BULK_CLEANUP_JOB) {
      await this.service.cleanup(tenantId, jobId);
      return { ok: true };
    }
    this.logger.warn(`Unknown bulk job: ${job.name}`);
    return { ok: false };
  }
}
