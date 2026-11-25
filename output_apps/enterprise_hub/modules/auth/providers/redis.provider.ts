import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../constants/auth.constants';

/** نوع کلاینت Redis تزریق‌شده در ماژول Auth. */
export type RedisClient = Redis;

/**
 * Provider کلاینت Redis اختصاصی ماژول احراز هویت و کش.
 *
 * T217 (#931): از دیتابیس لاجیکال مجزا (REDIS_CACHE_DB=1) یا هاست کش اختصاصی
 * (REDIS_CACHE_HOST/PORT) استفاده می‌کند تا کلیدهای دارای انقضا و کدهای موقت
 * از صف‌های پایدار BullMQ (در DB 0) تفکیک شوند.
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): RedisClient => {
    const host = config.get<string>('REDIS_CACHE_HOST') || config.get<string>('REDIS_HOST', '127.0.0.1');
    const port = Number(config.get<number | string>('REDIS_CACHE_PORT')) || Number(config.get<number | string>('REDIS_PORT', 6379)) || 6379;
    const db = Number(config.get<number | string>('REDIS_CACHE_DB', 1)) || 1;
    return new Redis({
      host,
      port,
      db,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
    });
  },
};
