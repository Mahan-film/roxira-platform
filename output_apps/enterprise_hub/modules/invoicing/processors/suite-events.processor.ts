import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SUITE_EVENT_INVOICE_STATUS_JOB,
  SUITE_EVENTS_QUEUE,
  SuiteInvoiceStatusEvent,
} from '../constants/suite-events.constants';
import { InvoicePostingService } from '../services/invoice-posting.service';

/**
 * Worker مصرف‌کننده صف `suite-events` برای هم‌آمیزی ماژول‌های مجموعه.
 *
 * پردازش رویدادهای صورتحساب (خروج انبار، ثبت اسناد دفتر کل) به‌صورت ناهمزمان
 * انجام می‌شود تا رشتهٔ HTTP بلاک نشود (Rule #5 - AGENTS.md). بدون شناسه
 * مستأجر معتبر، هیچ رکوردی ثبت نمی‌شود (Fail-closed).
 */
@Processor(SUITE_EVENTS_QUEUE)
export class SuiteEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(SuiteEventsProcessor.name);

  constructor(private readonly postingService: InvoicePostingService) {
    super();
  }

  async process(job: Job<SuiteInvoiceStatusEvent>): Promise<{ ok: boolean }> {
    if (job.name !== SUITE_EVENT_INVOICE_STATUS_JOB) {
      this.logger.warn(`Unknown suite-events job received: ${job.name}`);
      return { ok: false };
    }

    const { tenantId, invoiceId, status } = job.data;

    // Fail-closed: بدون شناسه مستأجر معتبر هرگز رکوردی ثبت نمی‌شود (§4.4).
    if (
      typeof tenantId !== 'string' ||
      tenantId.trim().length === 0 ||
      typeof invoiceId !== 'string' ||
      invoiceId.trim().length === 0 ||
      typeof status !== 'string'
    ) {
      this.logger.error('Suite event rejected: payload is missing tenantId/invoiceId/status.');
      return { ok: false };
    }

    await this.postingService.handle({ tenantId, invoiceId, status });
    return { ok: true };
  }
}
