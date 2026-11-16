import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TENANT_EXPORT_QUEUE } from '../../tenants/services/tenant-cancellation.service';
import { TenantExportService } from '../services/tenant-export.service';

export interface TenantExportJobData {
  tenantId: string;
  requestedAt?: string;
  reason?: string;
}

@Processor(TENANT_EXPORT_QUEUE, { concurrency: 2 })
export class TenantFullExportProcessor extends WorkerHost {
  private readonly logger = new Logger(TenantFullExportProcessor.name);

  constructor(private readonly exportService: TenantExportService) {
    super();
  }

  async process(job: Job<TenantExportJobData>): Promise<{ success: boolean; filename: string; checksum: string }> {
    const { tenantId } = job.data;
    this.logger.log(`Processing full export job ${job.id} for tenant ${tenantId}`);

    const { buffer, metadata, filename } = await this.exportService.generateFullExportZip(tenantId);

    this.logger.log(
      `Full export archive ${filename} generated for tenant ${tenantId} (${buffer.length} bytes, checksum: ${metadata.checksum})`,
    );

    return {
      success: true,
      filename,
      checksum: metadata.checksum,
    };
  }
}
