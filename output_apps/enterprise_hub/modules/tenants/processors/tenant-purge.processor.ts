import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  TENANT_PURGE_QUEUE,
  TenantCancellationService,
} from '../services/tenant-cancellation.service';

export interface TenantPurgeJobData {
  tenantId?: string;
  action?: 'purge-expired' | 'purge-single';
}

@Processor(TENANT_PURGE_QUEUE, { concurrency: 1 })
export class TenantPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(TenantPurgeProcessor.name);

  constructor(private readonly cancellationService: TenantCancellationService) {
    super();
  }

  async process(job: Job<TenantPurgeJobData>): Promise<{ success: boolean; result: any }> {
    const { tenantId, action = 'purge-expired' } = job.data || {};
    this.logger.log(`Processing tenant purge job ${job.id} (action: ${action}, tenantId: ${tenantId ?? 'all'})`);

    if (action === 'purge-single' && tenantId) {
      const res = await this.cancellationService.purgeTenant(tenantId);
      return { success: true, result: res };
    }

    const res = await this.cancellationService.purgeExpiredTenants();
    this.logger.log(`Purge job completed. Purged ${res.purgedCount} expired tenants.`);
    return { success: true, result: res };
  }
}
