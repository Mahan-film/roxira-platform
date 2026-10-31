import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleRequestEntity } from '../entities/module-request.entity';

/** Requests for modules. Tenant methods filter by tenantId; `listOpen` is for the platform operator only. */
@Injectable()
export class ModuleRequestsRepository {
  constructor(@InjectRepository(ModuleRequestEntity) private readonly repo: Repository<ModuleRequestEntity>) {}

  create(data: Partial<ModuleRequestEntity>): Promise<ModuleRequestEntity> {
    return this.repo.save(this.repo.create(data));
  }
  listForTenant(tenantId: string): Promise<ModuleRequestEntity[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }
  openFor(tenantId: string, module: string): Promise<ModuleRequestEntity | null> {
    return this.repo.findOne({ where: { tenantId, module, status: 'OPEN' } });
  }
  listOpen(): Promise<ModuleRequestEntity[]> {
    return this.repo.find({ where: { status: 'OPEN' }, order: { createdAt: 'ASC' }, take: 500 });
  }
  async resolve(tenantId: string, module: string, status: 'DONE' | 'DECLINED'): Promise<void> {
    await this.repo.update({ tenantId, module, status: 'OPEN' }, { status });
  }
}
