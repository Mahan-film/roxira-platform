import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { SalesCommissionPolicyEntity } from '../entities/sales-commission-policy.entity';

@Injectable()
export class CommissionPoliciesRepository {
  constructor(private readonly scope: TenantScope) {}

  private within<T>(tenantId: string, work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, undefined, work);
  }

  async upsert(
    tenantId: string,
    category: string,
    commissionRate: number,
    active: boolean = true,
  ): Promise<SalesCommissionPolicyEntity> {
    return this.within(tenantId, async (m) => {
      const repo = m.getRepository(SalesCommissionPolicyEntity);
      let entity = await repo.findOne({ where: { tenantId, category } });
      if (!entity) {
        entity = repo.create({
          tenantId,
          category,
          commissionRate,
          active,
        });
      } else {
        entity.commissionRate = commissionRate;
        entity.active = active;
      }
      return repo.save(entity);
    });
  }

  async list(tenantId: string): Promise<SalesCommissionPolicyEntity[]> {
    return this.within(tenantId, async (m) => {
      const repo = m.getRepository(SalesCommissionPolicyEntity);
      return repo.find({ where: { tenantId }, order: { category: 'ASC' } });
    });
  }

  async getRatesMap(tenantId: string): Promise<Record<string, number>> {
    const list = await this.list(tenantId);
    const map: Record<string, number> = {};
    for (const p of list) {
      if (p.active) {
        map[p.category] = Number(p.commissionRate);
      }
    }
    return map;
  }

  async deleteById(tenantId: string, id: number): Promise<boolean> {
    return this.within(tenantId, async (m) => {
      const res = await m.getRepository(SalesCommissionPolicyEntity).delete({ tenantId, id });
      return (res.affected ?? 0) > 0;
    });
  }
}
