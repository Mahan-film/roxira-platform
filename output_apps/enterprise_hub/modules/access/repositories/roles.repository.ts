import { Injectable } from '@nestjs/common';
import { CustomRoleEntity } from '../entities/custom-role.entity';
import { TenantScope } from '../services/tenant-scope';

/** Tenant-defined roles. Runs inside TenantScope (RLS) and filters by tenantId. */
@Injectable()
export class RolesRepository {
  constructor(private readonly scope: TenantScope) {}

  list(tenantId: string): Promise<CustomRoleEntity[]> {
    return this.scope.run(tenantId, (m) => m.find(CustomRoleEntity, { where: { tenantId }, order: { name: 'ASC' } }));
  }
  find(tenantId: string, id: string): Promise<CustomRoleEntity | null> {
    return this.scope.run(tenantId, (m) => m.findOne(CustomRoleEntity, { where: { tenantId, id } }));
  }
  create(data: Partial<CustomRoleEntity> & { tenantId: string }): Promise<CustomRoleEntity> {
    return this.scope.run(data.tenantId, (m) => m.save(m.create(CustomRoleEntity, data)));
  }
  save(entity: CustomRoleEntity): Promise<CustomRoleEntity> {
    return this.scope.run(entity.tenantId, (m) => m.save(entity));
  }
  async remove(tenantId: string, id: string): Promise<void> {
    await this.scope.run(tenantId, (m) => m.delete(CustomRoleEntity, { tenantId, id }));
  }
}
