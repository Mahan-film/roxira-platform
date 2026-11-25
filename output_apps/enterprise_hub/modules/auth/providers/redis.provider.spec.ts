import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisClientProvider } from './redis.provider';

jest.mock('ioredis');

describe('redisClientProvider (T217)', () => {
  const MockedRedis = Redis as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses default REDIS_CACHE_DB=1 and falls back to REDIS_HOST/PORT', () => {
    const config = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const env: Record<string, unknown> = {
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: 6379,
        };
        return env[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;

    if (typeof redisClientProvider === 'object' && 'useFactory' in redisClientProvider) {
      redisClientProvider.useFactory(config);
    }

    expect(MockedRedis).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 6379,
        db: 1,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
      }),
    );
  });

  it('honors custom REDIS_CACHE_HOST, REDIS_CACHE_PORT, and REDIS_CACHE_DB', () => {
    const config = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const env: Record<string, unknown> = {
          REDIS_HOST: 'redis-main',
          REDIS_PORT: 6379,
          REDIS_CACHE_HOST: 'redis-cache-dedicated',
          REDIS_CACHE_PORT: 6380,
          REDIS_CACHE_DB: 3,
        };
        return env[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;

    if (typeof redisClientProvider === 'object' && 'useFactory' in redisClientProvider) {
      redisClientProvider.useFactory(config);
    }

    expect(MockedRedis).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'redis-cache-dedicated',
        port: 6380,
        db: 3,
      }),
    );
  });
});
