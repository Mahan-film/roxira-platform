import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { CutoverEntity } from '../entities/cutover.entity';

export interface CreateCutoverInput {
  cutoverDate: string;
  preCutoverLockDate: string;
  periodLockId: number;
  openingJournalEntryId?: number | null;
  legacyNumberPrefix: string;
  executedBy: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Tenant-scoped persistence layer for `data_import_cutovers` (#1217).
 * Every read and write runs inside `TenantScope` (or an explicit caller-supplied transaction
 * `EntityManager` created by `TenantScope.run`) so FORCE RLS holds under `roxira_app`.
 */
@Injectable()
export class CutoverRepository {
  constructor(
    @InjectRepository(CutoverEntity)
    private readonly cutovers: Repository<CutoverEntity>,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  /**
   * Uses the DI-injected `TenantScope` (registered in `DataImportModule`) when available,
   * falling back to a `DataSource`-backed instance only for standalone repository unit tests.
   */
  private get tenantScope(): TenantScope | undefined {
    if (this.scope) return this.scope;
    const ds = this.cutovers?.manager?.connection;
    if (typeof (ds as { transaction?: unknown } | undefined)?.transaction === 'function') {
      return new TenantScope(ds);
    }
    return undefined;
  }

  private withRepo<T>(
    tenantId: string,
    work: (repo: Repository<CutoverEntity>) => Promise<T>,
    manager?: EntityManager,
  ): Promise<T> {
    if (manager) {
      return work(manager.getRepository(CutoverEntity));
    }
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(CutoverEntity)));
    }
    return work(this.cutovers);
  }

  /** Run multi-step cutover operations in one tenant-scoped PostgreSQL transaction. */
  runInTenantTransaction<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (!scope) {
      throw new Error('TenantScope is required for transactional cutover execution.');
    }
    return scope.run(tenantId, work);
  }

  /**
   * Serialize concurrent go-live attempts per tenant inside an open transaction using a
   * deterministic 64-bit key derived via built-in `md5` (works across all PostgreSQL builds
   * with lower collision probability than 32-bit hashes).
   */
  async acquireTenantCutoverLock(tenantId: string, manager: EntityManager): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`,
      [`cutover:${tenantId}`],
    );
  }

  async findActive(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<CutoverEntity | null> {
    return this.withRepo(
      tenantId,
      (repo) =>
        repo.findOne({
          where: { tenantId, isGoLiveActive: true },
          order: { createdAt: 'DESC' },
        }),
      manager,
    );
  }

  async createCutover(
    tenantId: string,
    data: CreateCutoverInput,
    manager?: EntityManager,
  ): Promise<CutoverEntity> {
    return this.withRepo(
      tenantId,
      async (repo) => {
        const entity = repo.create({
          tenantId,
          cutoverDate: data.cutoverDate,
          preCutoverLockDate: data.preCutoverLockDate,
          periodLockId: data.periodLockId,
          openingJournalEntryId: data.openingJournalEntryId ?? null,
          legacyNumberPrefix: data.legacyNumberPrefix,
          // New cutovers always start active; UQ_data_import_cutovers_one_active_per_tenant
          // guarantees at most one active row per tenant at the database layer.
          isGoLiveActive: true,
          executedBy: data.executedBy,
          metadata: data.metadata ?? null,
        });
        return repo.save(entity);
      },
      manager,
    );
  }

  async list(tenantId: string): Promise<CutoverEntity[]> {
    return this.withRepo(tenantId, (repo) =>
      repo.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      }),
    );
  }
}
