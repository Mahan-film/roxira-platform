import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ImportMappingMemoryEntity } from '../entities/import-mapping-memory.entity';

/** لایهٔ Repository حافظهٔ نگاشت؛ همهٔ متدها با `tenantId` به همان مستأجر محدودند. */
@Injectable()
export class ImportMappingMemoryRepository {
  constructor(
    @InjectRepository(ImportMappingMemoryEntity)
    private readonly rows: Repository<ImportMappingMemoryEntity>,
  ) {}

  find(tenantId: string, signature: string): Promise<ImportMappingMemoryEntity | null> {
    return this.rows.findOne({ where: { tenantId, signature } });
  }

  async upsert(
    tenantId: string,
    signature: string,
    entity: string,
    mapping: Record<string, string | null>,
  ): Promise<void> {
    const existing = await this.find(tenantId, signature);
    const now = new Date();
    if (existing) {
      existing.entity = entity;
      existing.mapping = mapping;
      existing.uses += 1;
      existing.updatedAt = now;
      await this.rows.save(existing);
      return;
    }
    await this.rows.save(
      this.rows.create({ id: randomUUID(), tenantId, signature, entity, mapping, uses: 1, createdAt: now, updatedAt: now }),
    );
  }

  /** حذف همهٔ حافظه‌های یک مستأجر (حق فراموشی/ریست). */
  async clear(tenantId: string): Promise<void> {
    await this.rows.delete({ tenantId });
  }
}
