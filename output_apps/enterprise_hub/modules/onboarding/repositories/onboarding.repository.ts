import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { StoredStepStatus, TenantOnboardingProgressEntity } from '../entities/tenant-onboarding-progress.entity';

/** Fields the service may change on the progress row. */
export interface ProgressPatch {
  steps?: Record<string, StoredStepStatus>;
  economicCode?: string | null;
  nationalId?: string | null;
  dismissed?: boolean;
  firstVisitHandledAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * The only access to `tenant_onboarding_progress`. Every call runs inside TenantScope, so RLS
 * (FORCE) limits it to the caller's organisation; the explicit tenant_id filter is the second check.
 */
@Injectable()
export class OnboardingRepository {
  constructor(private readonly scope: TenantScope) {}

  /** The row of the tenant, created empty on first use (a concurrent first call is harmless). */
  getOrCreate(tenantId: string): Promise<TenantOnboardingProgressEntity> {
    return this.scope.run(tenantId, (manager) => this.loadOrInsert(manager, tenantId, false));
  }

  /**
   * Reads the row under `FOR UPDATE`, applies `change` to it and saves the result, all in one
   * transaction, so two concurrent step updates cannot overwrite each other's `steps` map.
   */
  update(
    tenantId: string,
    change: (current: TenantOnboardingProgressEntity) => ProgressPatch,
  ): Promise<TenantOnboardingProgressEntity> {
    return this.scope.run(tenantId, async (manager) => {
      const current = await this.loadOrInsert(manager, tenantId, true);
      const patch = change(current);
      const repo = manager.getRepository(TenantOnboardingProgressEntity);
      // TypeORM refuses an update with no values; an empty patch (nothing to change) is a no-op.
      if (Object.keys(patch).length > 0) await repo.update({ tenantId }, patch);
      return repo.findOneOrFail({ where: { tenantId } });
    });
  }

  private async loadOrInsert(
    manager: EntityManager,
    tenantId: string,
    lock: boolean,
  ): Promise<TenantOnboardingProgressEntity> {
    const repo = manager.getRepository(TenantOnboardingProgressEntity);
    await repo
      .createQueryBuilder()
      .insert()
      .values({ tenantId })
      .orIgnore()
      .execute();
    return repo.findOneOrFail({
      where: { tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
}
