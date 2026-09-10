import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../constants/auth.constants';

/** نوع کلاینت Redis تزریق‌شده در ماژول Auth. */
export type RedisClient = Redis;

/**
 * Provider کلاینت Redis اختصاصی ماژول احراز هویت.
 *
 * از همان نمونه Redis پروداکشن (هر دو سرویس enterprise_app و
 * roxira_enterprise_backend) استفاده می‌کند و صرفاً برای ذخیره‌سازی
 * کدهای یک‌بارمصرف با انقضای کوتاه به کار می‌رود.
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): RedisClient => {
    return new Redis({
      host: config.get<string>('REDIS_HOST', '127.0.0.1'),
      port: config.get<number>('REDIS_PORT', 6379),
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
    });
  },
};
