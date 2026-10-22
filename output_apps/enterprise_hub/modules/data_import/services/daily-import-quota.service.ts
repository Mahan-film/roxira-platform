import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { REDIS_CLIENT } from '../../auth/constants/auth.constants';
import type { RedisClient } from '../../auth/providers/redis.provider';
import { dailyImportFileLimit } from '../constants/data-import.constants';
import { DataImportBatchRepository } from '../repositories/data-import-batch.repository';

/** شروع روز جاری به وقت سرور (برای شمارش دسته‌های امروز). */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** کلید روز جاری با قالب `YYYY-MM-DD`. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** ثانیه‌های باقی‌مانده تا پایان امروز (برای TTL کلید Redis). */
function secondsUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(
    60,
    Math.ceil((tomorrow.getTime() - now.getTime()) / 1000) + 60,
  );
}

/**
 * سقف ورود فایل روزانه هر مستأجر (پیش‌فرض ۲۰ فایل، قابل تنظیم با
 * `IMPORT_DAILY_FILES`).
 *
 * شمارش در صورت وجود کلاینت Redis با یک شمارنده روزانه (کلید با TTL تا پایان
 * روز) نگه داشته می‌شود؛ در غیر این صورت تعداد دسته‌های ورود امروز از جدول
 * `data_import_batches` خوانده می‌شود. شناسه مستأجر همواره از توکن می‌آید و
 * کلید Redis نیز به همان مستأجر محدود است.
 */
@Injectable()
export class DailyImportQuotaService {
  private readonly logger = new Logger(DailyImportQuotaService.name);

  constructor(
    private readonly batchRepository: DataImportBatchRepository,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClient,
  ) {}

  /** شمارش فایل‌های ورودی امروز مستأجر (Redis در صورت وجود، وگرنه جدول دسته‌ها). */
  async usedToday(tenantId: string): Promise<number> {
    const redis = this.redis;
    if (redis) {
      try {
        const raw = await redis.get(this.redisKey(tenantId));
        const value = raw ? Number.parseInt(raw, 10) : 0;
        return Number.isFinite(value) && value > 0 ? value : 0;
      } catch (error) {
        this.logger.warn(
          `[DATA-IMPORT] خواندن سقف روزانه از Redis ناموفق بود؛ استفاده از جدول دسته‌ها: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return this.batchRepository.countCreatedSince(tenantId, startOfToday());
  }

  /** در صورت رسیدن به سقف روزانه، خطای ۴۰۰ فارسی پرتاب می‌کند. */
  async assertWithinQuota(tenantId: string): Promise<void> {
    const limit = dailyImportFileLimit();
    const used = await this.usedToday(tenantId);
    if (used >= limit) {
      throw new BadRequestException(
        `سقف ورود روزانه (${limit} فایل) تکمیل شده است؛ فردا دوباره تلاش کنید.`,
      );
    }
  }

  /** ثبت یک فایل ورودی (فقط Redis؛ در حالت جدول، شمارش از خود دسته‌ها می‌آید). */
  async recordImport(tenantId: string): Promise<void> {
    const redis = this.redis;
    if (!redis) {
      return;
    }
    try {
      const key = this.redisKey(tenantId);
      const used = await redis.incr(key);
      if (used === 1) {
        await redis.expire(key, secondsUntilTomorrow());
      }
    } catch (error) {
      this.logger.warn(
        `[DATA-IMPORT] ثبت سقف روزانه در Redis ناموفق بود: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private redisKey(tenantId: string): string {
    return `data-import:daily-files:${tenantId}:${todayKey()}`;
  }
}
