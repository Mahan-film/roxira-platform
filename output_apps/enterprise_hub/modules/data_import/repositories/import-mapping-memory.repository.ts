import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ImportMappingMemoryEntity } from '../entities/import-mapping-memory.entity';

/** لایهٔ Repository حافظهٔ نگاشت؛ همهٔ متدها با `tenantId` به همان مستأجر محدودند. */
@Injectable()
export class ImportMappingMemoryRepository {
  constructor(
    @InjectRepository(ImportMappingMemoryEntity)
    private readonly rows: Repository<ImportMappingMemoryEntity>,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    const ds = this.rows?.manager?.connection;
    if (typeof (ds as { transaction?: unknown } | undefined)?.transaction === 'function') {
      return new TenantScope(ds);
    }
    return undefined;
  }

  private withRows<T>(
    tenantId: string,
    work: (repo: Repository<ImportMappingMemoryEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(ImportMappingMemoryEntity)));
    }
    return work(this.rows);
  }

  find(tenantId: string, signature: string): Promise<ImportMappingMemoryEntity | null> {
    return this.withRows(tenantId, (repo) => repo.findOne({ where: { tenantId, signature } }));
  }

  async upsert(
    tenantId: string,
    signature: string,
    entity: string,
    mapping: Record<string, string | null>,
  ): Promise<void> {
    await this.withRows(tenantId, async (repo) => {
      const existing = await repo.findOne({ where: { tenantId, signature } });
      const now = new Date();
      if (existing) {
        existing.entity = entity;
        existing.mapping = mapping;
        existing.uses += 1;
        existing.updatedAt = now;
        await repo.save(existing);
        return;
      }
      await repo.save(
        repo.create({
          id: randomUUID(),
          tenantId,
          signature,
          entity,
          mapping,
          uses: 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
    });
  }

  /** حذف همهٔ حافظه‌های یک مستأجر (حق فراموشی/ریست). */
  async clear(tenantId: string): Promise<void> {
    await this.withRows(tenantId, async (repo) => {
      await repo.delete({ tenantId });
    });
  }
}
