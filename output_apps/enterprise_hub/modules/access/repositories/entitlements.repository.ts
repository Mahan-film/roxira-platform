import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntitlementEntity } from '../entities/entitlement.entity';

@Injectable()
export class EntitlementsRepository {
  private readonly logger = new Logger(EntitlementsRepository.name);

  constructor(@InjectRepository(EntitlementEntity) private readonly repo: Repository<EntitlementEntity>) {}

  async list(tenantId: string): Promise<EntitlementEntity[]> {
    try {
      const rows = await this.repo.query(
        `SELECT * FROM public.lookup_tenant_entitlements($1)`,
        [tenantId],
      );
      if (rows) {
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
    } catch (err) {
      this.logger.debug(`lookup_tenant_entitlements fallback: ${err}`);
    }
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.find(EntitlementEntity, { where: { tenantId } });
    });
  }

  async set(tenantId: string, module: string, enabled: boolean, updatedBy: string | null): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await m.getRepository(EntitlementEntity).upsert(
        { tenantId, module, enabled, updatedBy },
        ['tenantId', 'module'],
      );
    });
  }
}
