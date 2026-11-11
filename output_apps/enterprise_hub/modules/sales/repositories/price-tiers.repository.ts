import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';
import { PriceTierEntity } from '../entities/price-tier.entity';
import { getCurrentTehranDate } from '../services/price-tier.service';

export interface PriceTierInput {
  sku: string;
  customerGroup: CustomerGroup;
  unitPrice: bigint;
  discountPercent?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

@Injectable()
export class PriceTiersRepository {
  constructor(private readonly scope: TenantScope) {}

  private within<T>(tenantId: string, work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, undefined, work);
  }

  async create(tenantId: string, input: PriceTierInput): Promise<PriceTierEntity> {
    return this.within(tenantId, async (m) => {
      const repo = m.getRepository(PriceTierEntity);
      const entity = repo.create({
        tenantId,
        sku: input.sku,
        customerGroup: input.customerGroup,
        unitPrice: input.unitPrice,
        discountPercent: input.discountPercent ?? 0,
        effectiveFrom: input.effectiveFrom ?? getCurrentTehranDate(),
        effectiveTo: input.effectiveTo ?? null,
      });
      return repo.save(entity);
    });
  }

  async list(tenantId: string, sku?: string, group?: CustomerGroup): Promise<PriceTierEntity[]> {
    return this.within(tenantId, async (m) => {
      const repo = m.getRepository(PriceTierEntity);
      const qb = repo.createQueryBuilder('pt').where('pt.tenantId = :tenantId', { tenantId });
      if (sku) {
        qb.andWhere('pt.sku = :sku', { sku });
      }
      if (group) {
        qb.andWhere('pt.customerGroup = :group', { group });
      }
      qb.orderBy('pt.effectiveFrom', 'DESC').addOrderBy('pt.id', 'DESC');
      return qb.getMany();
    });
  }

  async findActiveTiers(
    tenantId: string,
    sku: string,
    group: CustomerGroup,
    referenceDate: string,
  ): Promise<PriceTierEntity[]> {
    return this.within(tenantId, async (m) => {
      const repo = m.getRepository(PriceTierEntity);
      return repo
        .createQueryBuilder('pt')
        .where('pt.tenantId = :tenantId', { tenantId })
        .andWhere('pt.sku = :sku', { sku })
        .andWhere('pt.customerGroup = :group', { group })
        .andWhere('pt.effectiveFrom <= :referenceDate', { referenceDate })
        .andWhere('(pt.effectiveTo IS NULL OR pt.effectiveTo >= :referenceDate)', { referenceDate })
        .orderBy('pt.effectiveFrom', 'DESC')
        .getMany();
    });
  }

  async deleteById(tenantId: string, id: number): Promise<boolean> {
    return this.within(tenantId, async (m) => {
      const res = await m.getRepository(PriceTierEntity).delete({ tenantId, id });
      return (res.affected ?? 0) > 0;
    });
  }
}
