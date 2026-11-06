import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ContractEntity } from '../entities/contract.entity';
import { ContractInsuranceType, ContractSide, ContractStatus } from '../enums/contracting.enum';

export interface ContractInput {
  code: string;
  title: string;
  side: ContractSide;
  partyCode: string;
  projectId: number | null;
  contractDate: string;
  amount: string;
  advanceAmount: string;
  insuranceType: ContractInsuranceType | null;
  status?: ContractStatus;
}

export interface ContractPatch {
  title?: string;
  projectId?: number | null;
  contractDate?: string;
  amount?: string;
  advanceAmount?: string;
  insuranceType?: ContractInsuranceType | null;
  status?: ContractStatus;
}

export interface ContractFilter {
  side?: ContractSide;
  status?: ContractStatus;
  projectId?: number;
  partyCode?: string;
  search?: string;
  limit: number;
  offset: number;
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The only access point to `erp_contracts` (FORCE RLS: every call runs in a TenantScope transaction). */
@Injectable()
export class ContractRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  list(tenantId: string, filter: ContractFilter): Promise<{ rows: ContractEntity[]; total: number }> {
    return this.within(tenantId, undefined, async (m) => {
      const qb = m.getRepository(ContractEntity).createQueryBuilder('c').where('c.tenant_id = :tenantId', { tenantId });
      if (filter.side) qb.andWhere('c.side = :side', { side: filter.side });
      if (filter.status) qb.andWhere('c.status = :status', { status: filter.status });
      if (filter.projectId !== undefined) qb.andWhere('c.project_id = :projectId', { projectId: filter.projectId });
      if (filter.partyCode) qb.andWhere('c.party_code = :partyCode', { partyCode: filter.partyCode });
      if (filter.search) {
        qb.andWhere('(c.code ILIKE :pattern OR c.title ILIKE :pattern)', { pattern: `%${escapeLike(filter.search)}%` });
      }
      const total = await qb.getCount();
      const rows = await qb.orderBy('c.code', 'ASC').limit(filter.limit).offset(filter.offset).getMany();
      return { rows, total };
    });
  }

  findByCode(tenantId: string, code: string): Promise<ContractEntity | null> {
    return this.within(tenantId, undefined, (m) => m.getRepository(ContractEntity).findOne({ where: { tenantId, code } }));
  }

  findById(tenantId: string, id: number, manager?: EntityManager): Promise<ContractEntity | null> {
    return this.within(tenantId, manager, (m) => m.getRepository(ContractEntity).findOne({ where: { tenantId, id } }));
  }

  create(tenantId: string, input: ContractInput): Promise<ContractEntity> {
    return this.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(ContractEntity);
      return repo.save(repo.create({ ...input, status: input.status ?? ContractStatus.DRAFT, tenantId }));
    });
  }

  update(tenantId: string, id: number, patch: ContractPatch): Promise<ContractEntity | null> {
    return this.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(ContractEntity);
      if (Object.keys(patch).length > 0) await repo.update({ id, tenantId }, patch);
      return repo.findOne({ where: { id, tenantId } });
    });
  }
}
