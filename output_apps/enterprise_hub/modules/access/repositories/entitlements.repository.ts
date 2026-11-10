import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntitlementEntity } from '../entities/entitlement.entity';

@Injectable()
export class EntitlementsRepository {
  constructor(@InjectRepository(EntitlementEntity) private readonly repo: Repository<EntitlementEntity>) {}

  async list(tenantId: string): Promise<EntitlementEntity[]> {
    try {
      const rows = await this.repo.query(
        `SELECT * FROM public.lookup_tenant_entitlements($1)`,
        [tenantId],
      );
      if (rows && rows.length > 0) {
        return rows.map((r: any) =>
          this.repo.create({
            tenantId: r.tenant_id ?? r.tenantId,
            module: r.module,
            enabled: r.enabled,
            updatedBy: r.updated_by ?? r.updatedBy,
            updatedAt: r.updated_at ?? r.updatedAt,
          }),
        );
      }
      return [];
    } catch {
      return this.repo.find({ where: { tenantId } });
    }
  }

  async set(tenantId: string, module: string, enabled: boolean, updatedBy: string | null): Promise<void> {
    await this.repo.upsert({ tenantId, module, enabled, updatedBy }, ['tenantId', 'module']);
  }
}
