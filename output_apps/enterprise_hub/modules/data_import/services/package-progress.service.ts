import { Inject, Injectable, Optional } from '@nestjs/common';
import { REDIS_CLIENT } from '../../auth/constants/auth.constants';
import type { RedisClient } from '../../auth/providers/redis.provider';
import { PACKAGE_MAX_ERRORS } from '../constants/package-import.constants';

/** پیشرفت commit یک بستهٔ دیتابیس. */
export interface PackageProgress {
  phase: string;
  done: number;
  total: number;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

/** پیشرفت اولیهٔ یک بسته. */
export function emptyProgress(): PackageProgress {
  return {
    phase: 'pending',
    done: 0,
    total: 0,
    inserted: {},
    skipped: {},
    errors: [],
  };
}

/**
 * نگه‌داری پیشرفت commit در Redis (در نبود Redis، در حافظهٔ همان پروسه).
 * کلید همواره به مستأجر و شناسهٔ بسته محدود است.
 */
@Injectable()
export class PackageProgressService {
  private readonly memory = new Map<string, PackageProgress>();

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClient,
  ) {}

  private redisKey(tenantId: string, packageId: string): string {
    return `data-import:package-progress:${tenantId}:${packageId}`;
  }

  private memoryKey(tenantId: string, packageId: string): string {
    return `${tenantId}::${packageId}`;
  }

  /** ثبت پیشرفت (Redis + حافظه). */
  async set(
    tenantId: string,
    packageId: string,
    progress: PackageProgress,
  ): Promise<void> {
    const limited: PackageProgress = {
      ...progress,
      errors: progress.errors.slice(0, PACKAGE_MAX_ERRORS),
    };
    this.memory.set(this.memoryKey(tenantId, packageId), limited);
    const redis = this.redis;
    if (redis) {
      try {
        await redis.setex(
          this.redisKey(tenantId, packageId),
          60 * 60 * 2,
          JSON.stringify(limited),
        );
      } catch {
        // نبود Redis جریان را متوقف نمی‌کند.
      }
    }
  }

  /** خواندن پیشرفت بسته. */
  async get(
    tenantId: string,
    packageId: string,
  ): Promise<PackageProgress | null> {
    const redis = this.redis;
    if (redis) {
      try {
        const raw = await redis.get(this.redisKey(tenantId, packageId));
        if (raw) {
          return JSON.parse(raw) as PackageProgress;
        }
      } catch {
        // بازگشت به حافظه.
      }
    }
    return this.memory.get(this.memoryKey(tenantId, packageId)) ?? null;
  }
}
