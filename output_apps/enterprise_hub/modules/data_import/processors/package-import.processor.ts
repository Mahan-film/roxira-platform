import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  PACKAGE_ANALYZE_JOB,
  PACKAGE_COMMIT_JOB,
  PACKAGE_QUEUE_NAME,
} from '../constants/package-import.constants';
import { PackageCommitTableInput } from '../services/package-commit.service';
import { PackageAnalysisService } from '../services/package-analysis.service';
import { PackageCommitService } from '../services/package-commit.service';

interface AnalyzeJobData {
  tenantId: string;
  packageId: string;
}

interface CommitJobData {
  tenantId: string;
  packageId: string;
  tables: PackageCommitTableInput[];
  batchId: string;
}

/**
 * Worker صف BullMQ برای تحلیل و ثبت بستهٔ دیتابیس.
 * تحلیل و ثبت سنگین هرگز رشتهٔ HTTP را بلاک نمی‌کنند (Rule #5 - AGENTS.md).
 */
@Processor(PACKAGE_QUEUE_NAME)
export class PackageImportProcessor extends WorkerHost {
  private readonly logger = new Logger(PackageImportProcessor.name);

  constructor(
    private readonly analysisService: PackageAnalysisService,
    private readonly commitService: PackageCommitService,
  ) {
    super();
  }

  async process(job: Job): Promise<{ ok: boolean }> {
    if (job.name === PACKAGE_ANALYZE_JOB) {
      const { tenantId, packageId } = job.data as AnalyzeJobData;
      if (!tenantId || !packageId) {
        this.logger.error('Analyze job rejected: missing tenantId/packageId.');
        return { ok: false };
      }
      await this.analysisService.analyze(tenantId, packageId);
      return { ok: true };
    }

    if (job.name === PACKAGE_COMMIT_JOB) {
      const { tenantId, packageId, tables, batchId } =
        job.data as CommitJobData;
      if (!tenantId || !packageId || !batchId) {
        this.logger.error('Commit job rejected: missing tenantId/packageId.');
        return { ok: false };
      }
      await this.commitService.commit(tenantId, packageId, tables ?? [], batchId);
      return { ok: true };
    }

    this.logger.warn(`Unknown package-import job received: ${job.name}`);
    return { ok: false };
  }
}
