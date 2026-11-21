import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { TenantScope } from '../../access/services/tenant-scope';
import { CutoverEntity } from '../entities/cutover.entity';

export interface CreateCutoverInput {
  id?: string;
  cutoverDate: string;
  preCutoverLockDate: string;
  periodLockId: number;
  openingJournalEntryId?: number | null;
  legacyNumberPrefix?: string;
  isGoLiveActive?: boolean;
  metadata?: Record<string, unknown> | null;
}

/**
 * لایه دسترسی به داده جدول کات‌اوور و وضعیت ورود به عملیات زنده (`data_import_cutovers`).
 * کلیه عملیات با استفاده از `TenantScope` به مستأجر مربوطه محدود می‌شود.
 */
@Injectable()
export class CutoverRepository {
  constructor(
    @InjectRepository(CutoverEntity)
    private readonly repo: Repository<CutoverEntity>,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    const ds = this.repo?.manager?.connection;
    if (
      typeof (ds as { transaction?: unknown } | undefined)?.transaction ===
      'function'
    ) {
      return new TenantScope(ds);
    }
    return undefined;
  }

  private withRepo<T>(
    tenantId: string,
    work: (repo: Repository<CutoverEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(CutoverEntity)));
    }
    return work(this.repo);
  }

  async findActive(tenantId: string): Promise<CutoverEntity | null> {
    return this.withRepo(tenantId, (repo) =>
      repo.findOne({
        where: { tenantId, isGoLiveActive: true },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  async createCutover(
    tenantId: string,
    input: CreateCutoverInput,
  ): Promise<CutoverEntity> {
    return this.withRepo(tenantId, async (repo) => {
      const entity = repo.create({
        id: input.id ?? randomUUID(),
        tenantId,
        cutoverDate: input.cutoverDate,
        preCutoverLockDate: input.preCutoverLockDate,
        periodLockId: input.periodLockId,
        openingJournalEntryId: input.openingJournalEntryId ?? null,
        legacyNumberPrefix: input.legacyNumberPrefix ?? 'LEGACY-',
        isGoLiveActive: input.isGoLiveActive ?? true,
        metadata: input.metadata ?? null,
      });
      return repo.save(entity);
    });
  }

  async listAll(tenantId: string): Promise<CutoverEntity[]> {
    return this.withRepo(tenantId, (repo) =>
      repo.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      }),
    );
  }
}
