import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '../../auth/constants/auth.constants';
import type { RedisClient } from '../../auth/providers/redis.provider';
import {
  ASSISTANT_RATE_LIMIT_DEFAULT,
  ASSISTANT_RATE_WINDOW_MS,
} from '../constants/assistant.constants';

/**
 * محدودیت نرخ دستیار برای هر سازمان (پنجره لغزان یک‌ساعته).
 *
 * گارد Throttler سراسری پیش از JWT اجرا می‌شود و فقط IP را می‌شناسد؛ این
 * سرویس پس از احراز هویت و با شناسه مستأجر تأییدشده سقف می‌گذارد تا هزینه
 * مدل یک سازمان محدود بماند. سقف با `ASSISTANT_RATE_LIMIT_PER_HOUR` قابل
 * تنظیم است. شمارش در Redis (sorted set هر مستأجر) نگه داشته می‌شود تا با
 * ری‌استارت و چند نمونه پایدار بماند؛ اگر Redis در دسترس نباشد، به شمارش
 * درون‌حافظه‌ای همان پردازه برمی‌گردد.
 */
@Injectable()
export class AssistantRateLimiterService {
  private readonly logger = new Logger(AssistantRateLimiterService.name);
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;

  constructor(
    @Optional() config?: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClient,
  ) {
    const configured = Number(
      config?.get<string>('ASSISTANT_RATE_LIMIT_PER_HOUR') ?? '',
    );
    this.limit =
      Number.isInteger(configured) && configured > 0
        ? configured
        : ASSISTANT_RATE_LIMIT_DEFAULT;
  }

  /** ثبت یک پرسش؛ در صورت عبور از سقف، خطای ۴۲۹ پرتاب می‌شود. */
  async consume(tenantId: string, now: number = Date.now()): Promise<void> {
    if (this.redis) {
      try {
        const oldest = await this.consumeRedis(tenantId, now);
        if (oldest === null) {
          return;
        }
        throw this.tooMany(oldest, now);
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        this.logger.warn(
          `سقف دستیار از Redis خوانده نشد؛ شمارش درون‌حافظه‌ای: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.consumeMemory(tenantId, now);
  }

  /**
   * افزودن پرسش به sorted set مستأجر و شمارش پنجره در یک MULTI.
   * اگر از سقف گذشت، همان عضو حذف و زمان قدیمی‌ترین پرسش برگردانده می‌شود.
   */
  private async consumeRedis(
    tenantId: string,
    now: number,
  ): Promise<number | null> {
    const redis = this.redis as RedisClient;
    const key = `assistant:rate:${tenantId}`;
    const member = `${now}:${randomUUID()}`;
    const results = await redis
      .multi()
      .zremrangebyscore(key, 0, now - ASSISTANT_RATE_WINDOW_MS)
      .zadd(key, now, member)
      .zcard(key)
      .pexpire(key, ASSISTANT_RATE_WINDOW_MS)
      .exec();
    if (!results) {
      throw new Error('MULTI aborted');
    }
    const [error, count] = results[2];
    if (error) {
      throw error;
    }
    if (Number(count) <= this.limit) {
      return null;
    }
    await redis.zrem(key, member);
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    return oldest.length >= 2 ? Number(oldest[1]) : now;
  }

  private consumeMemory(tenantId: string, now: number): void {
    const windowStart = now - ASSISTANT_RATE_WINDOW_MS;
    const recent = (this.hits.get(tenantId) ?? []).filter(
      (time) => time > windowStart,
    );
    if (recent.length >= this.limit) {
      this.hits.set(tenantId, recent);
      throw this.tooMany(recent[0], now);
    }
    recent.push(now);
    this.hits.set(tenantId, recent);
    this.prune(windowStart);
  }

  private tooMany(oldest: number, now: number): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `سقف ${this.limit} پرسش در ساعت برای سازمان شما پر شده است.`,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + ASSISTANT_RATE_WINDOW_MS - now) / 1000),
        ),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** حذف سازمان‌های بدون پرسش در پنجره جاری (جلوگیری از رشد حافظه). */
  private prune(windowStart: number): void {
    if (this.hits.size < 1000) {
      return;
    }
    for (const [tenantId, times] of this.hits) {
      if (times.every((time) => time <= windowStart)) {
        this.hits.delete(tenantId);
      }
    }
  }
}
