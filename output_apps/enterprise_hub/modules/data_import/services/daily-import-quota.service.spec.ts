import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { DailyImportQuotaService } from './daily-import-quota.service';
import { DataImportBatchRepository } from '../repositories/data-import-batch.repository';

interface RedisMock {
  get: jest.Mock;
  incr: jest.Mock;
  expire: jest.Mock;
}

function makeRepository(): { countCreatedSince: jest.Mock } {
  return { countCreatedSince: jest.fn().mockResolvedValue(0) };
}

function makeRedis(): RedisMock {
  return {
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };
}

describe('DailyImportQuotaService', () => {
  it('falls back to the batch table when no Redis client is available', async () => {
    const repository = makeRepository();
    repository.countCreatedSince.mockResolvedValue(20);
    const service = new DailyImportQuotaService(
      repository as unknown as DataImportBatchRepository,
    );

    await expect(service.assertWithinQuota('tenant-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.countCreatedSince).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(Date),
    );
  });

  it('allows imports while under the daily cap', async () => {
    const repository = makeRepository();
    repository.countCreatedSince.mockResolvedValue(19);
    const service = new DailyImportQuotaService(
      repository as unknown as DataImportBatchRepository,
    );

    await expect(service.assertWithinQuota('tenant-1')).resolves.toBeUndefined();
  });

  it('uses the Redis counter when a client is injected', async () => {
    const repository = makeRepository();
    const redis = makeRedis();
    redis.get.mockResolvedValue('20');
    const service = new DailyImportQuotaService(
      repository as unknown as DataImportBatchRepository,
      redis as never,
    );

    await expect(service.assertWithinQuota('tenant-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.countCreatedSince).not.toHaveBeenCalled();
  });

  it('increments the Redis counter with a daily TTL on the first import', async () => {
    const repository = makeRepository();
    const redis = makeRedis();
    redis.incr.mockResolvedValue(1);
    const service = new DailyImportQuotaService(
      repository as unknown as DataImportBatchRepository,
      redis as never,
    );

    await service.recordImport('tenant-1');

    expect(redis.incr).toHaveBeenCalledWith(
      expect.stringContaining('data-import:daily-files:tenant-1:'),
    );
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), expect.any(Number));
  });

  it('does not refresh the TTL for later imports the same day', async () => {
    const redis = makeRedis();
    redis.incr.mockResolvedValue(2);
    const service = new DailyImportQuotaService(
      makeRepository() as unknown as DataImportBatchRepository,
      redis as never,
    );

    await service.recordImport('tenant-1');

    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('honours the IMPORT_DAILY_FILES override', async () => {
    process.env.IMPORT_DAILY_FILES = '2';
    try {
      const repository = makeRepository();
      repository.countCreatedSince.mockResolvedValue(2);
      const service = new DailyImportQuotaService(
        repository as unknown as DataImportBatchRepository,
      );

      await expect(service.assertWithinQuota('tenant-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    } finally {
      delete process.env.IMPORT_DAILY_FILES;
    }
  });

  it('falls back to the batch table when Redis read fails', async () => {
    const repository = makeRepository();
    repository.countCreatedSince.mockResolvedValue(3);
    const redis = makeRedis();
    redis.get.mockRejectedValue(new Error('redis down'));
    const service = new DailyImportQuotaService(
      repository as unknown as DataImportBatchRepository,
      redis as never,
    );

    await expect(service.usedToday('tenant-1')).resolves.toBe(3);
    expect(repository.countCreatedSince).toHaveBeenCalled();
  });
});
