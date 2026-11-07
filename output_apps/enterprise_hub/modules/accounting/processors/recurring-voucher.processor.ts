import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { tehranIsoDate } from '../../hr/services/jalali-period';
import {
  RECURRING_VOUCHERS_QUEUE,
  RECURRING_VOUCHER_RUN_JOB,
} from '../constants/recurring-voucher.constants';
import { RecurringVoucherService } from '../services/recurring-voucher.service';

/**
 * Worker for the `recurring-vouchers` queue. The daily repeatable job registered by the service
 * fires once and this worker runs the due templates tenant by tenant, so a slow tenant never blocks
 * the HTTP thread and two workers cannot double-post (the run row's unique key is the guard).
 */
@Processor(RECURRING_VOUCHERS_QUEUE)
export class RecurringVoucherProcessor extends WorkerHost {
  private readonly logger = new Logger(RecurringVoucherProcessor.name);

  constructor(private readonly service: RecurringVoucherService) {
    super();
  }

  async process(
    job: Job,
  ): Promise<{ tenants: number; created: number; reversed: number; skipped: number }> {
    if (job.name !== RECURRING_VOUCHER_RUN_JOB) {
      this.logger.warn(`Unknown recurring-vouchers job received: ${job.name}`);
      return { tenants: 0, created: 0, reversed: 0, skipped: 0 };
    }

    const today = tehranIsoDate(new Date());
    const tenantIds = await this.service.tenantIds();
    let created = 0;
    let reversed = 0;
    let skipped = 0;
    for (const tenantId of tenantIds) {
      try {
        const result = await this.service.runDue(tenantId, today);
        created += result.created;
        reversed += result.reversed;
        skipped += result.skipped.length;
      } catch (error) {
        this.logger.error(
          `Recurring voucher run failed for tenant ${tenantId}: ${(error as Error).message}`,
        );
      }
    }
    return { tenants: tenantIds.length, created, reversed, skipped };
  }
}
