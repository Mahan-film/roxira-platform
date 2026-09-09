import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CreateDamageCalculationDto } from '../dto/create-damage-calculation.dto';
import { DamagesService } from '../services/damages.service';
import { DAMAGES_BULK_JOB_NAME, DAMAGES_QUEUE_NAME } from '../constants/damages.constants';

interface BulkDamageJobPayload {
  items: CreateDamageCalculationDto[];
}

/**
 * Worker مصرف‌کننده صف Redis/BullMQ برای پردازش دسته‌ای محاسبات
 * خسارت تاخیر تادیه، بدون بلاک کردن رشته اصلی HTTP (Rule #5 - AGENTS.md).
 */
@Processor(DAMAGES_QUEUE_NAME)
export class DamagesQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(DamagesQueueProcessor.name);

  constructor(private readonly damagesService: DamagesService) {
    super();
  }

  async process(job: Job<BulkDamageJobPayload>): Promise<{ processed: number; failed: number }> {
    if (job.name !== DAMAGES_BULK_JOB_NAME) {
      this.logger.warn(`Unknown job name received: ${job.name}`);
      return { processed: 0, failed: 0 };
    }

    const { items } = job.data;
    let processed = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await this.damagesService.calculateAndPersist(item);
        processed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `خطا در محاسبه خسارت برای مرجع ${item.contractReferenceNumber ?? 'نامشخص'}: ${
            (error as Error).message
          }`,
        );
      }

      await job.updateProgress(Math.round(((processed + failed) / items.length) * 100));
    }

    return { processed, failed };
  }
}
