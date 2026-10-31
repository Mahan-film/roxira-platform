import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntitlementEntity } from '../entities/entitlement.entity';

@Injectable()
export class EntitlementsRepository {
  constructor(@InjectRepository(EntitlementEntity) private readonly repo: Repository<EntitlementEntity>) {}

  list(tenantId: string): Promise<EntitlementEntity[]> {
    return this.repo.find({ where: { tenantId } });
  }

  async set(tenantId: string, module: string, enabled: boolean, updatedBy: string | null): Promise<void> {
    await this.repo.upsert({ tenantId, module, enabled, updatedBy }, ['tenantId', 'module']);
  }
}
