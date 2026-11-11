import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleRequestEntity } from '../entities/module-request.entity';

/** Requests for modules. Tenant methods filter by tenantId; `listOpen` is for the platform operator only. */
@Injectable()
export class ModuleRequestsRepository {
  private readonly logger = new Logger(ModuleRequestsRepository.name);

  constructor(@InjectRepository(ModuleRequestEntity) private readonly repo: Repository<ModuleRequestEntity>) {}

  create(data: Partial<ModuleRequestEntity>): Promise<ModuleRequestEntity> {
    return this.repo.manager.transaction(async (m) => {
      if (data.tenantId) {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [data.tenantId]);
      }
      return m.save(m.create(ModuleRequestEntity, data));
    });
  }

  listForTenant(tenantId: string): Promise<ModuleRequestEntity[]> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.find(ModuleRequestEntity, { where: { tenantId }, order: { createdAt: 'DESC' } });
    });
  }

  openFor(tenantId: string, module: string): Promise<ModuleRequestEntity | null> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.findOne(ModuleRequestEntity, { where: { tenantId, module, status: 'OPEN' } });
    });
  }

  async listOpen(): Promise<ModuleRequestEntity[]> {
    try {
      const rows = await this.repo.query(`SELECT * FROM public.list_open_module_requests()`);
      if (rows) {
        return rows.map((r: any) =>
          this.repo.create({
            id: r.id,
            tenantId: r.tenant_id,
            module: r.module,
            status: r.status,
            requestedBy: r.requested_by,
            createdAt: r.created_at,
          }),
        );
      }
      return [];
    } catch (err) {
      this.logger.error(`list_open_module_requests error: ${err}`);
      throw err;
    }
  }

  async resolve(tenantId: string, module: string, status: 'DONE' | 'DECLINED'): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await m.update(ModuleRequestEntity, { tenantId, module, status: 'OPEN' }, { status });
    });
  }
}
