import { Injectable } from '@nestjs/common';
import { EntityManager, FindOptionsWhere } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { MasterDataChangeLogEntity } from '../entities/master-data-change-log.entity';

export interface RecordMasterDataChangeInput {
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
}

/** Records immediate master-data changes (e.g. VAT codes, chart of accounts) for auditability (T178). */
@Injectable()
export class MasterDataChangeLogService {
  constructor(private readonly scope: TenantScope) {}

  async recordChange(
    tenantId: string,
    input: RecordMasterDataChangeInput,
    manager?: EntityManager,
  ): Promise<MasterDataChangeLogEntity> {
    return this.scope.within(tenantId, manager, async (m) => {
      const repo = m.getRepository(MasterDataChangeLogEntity);
      const row = repo.create({
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        fieldName: input.fieldName,
        oldValue: input.oldValue,
        newValue: input.newValue,
        changedBy: input.changedBy,
      });
      return repo.save(row);
    });
  }

  async listChanges(
    tenantId: string,
    filter: { entityType?: string; entityId?: string } = {},
    manager?: EntityManager,
  ): Promise<MasterDataChangeLogEntity[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const where: FindOptionsWhere<MasterDataChangeLogEntity> = { tenantId };
      if (filter.entityType) where.entityType = filter.entityType;
      if (filter.entityId) where.entityId = filter.entityId;
      return m.getRepository(MasterDataChangeLogEntity).find({
        where,
        order: { changedAt: 'DESC', id: 'DESC' },
      });
    });
  }
}
