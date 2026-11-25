import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BranchEntity } from '../entities/branch.entity';
import { DepartmentEntity } from '../entities/department.entity';
import { TenantScope } from '../services/tenant-scope';

/** Branches and departments. Every call runs inside a TenantScope transaction (RLS) and filters by tenantId. */
@Injectable()
export class StructureRepository {
  constructor(private readonly scope: TenantScope) {}

  transaction<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, undefined, fn);
  }

  listBranches(tenantId: string): Promise<BranchEntity[]> {
    return this.scope.run(tenantId, (m) => m.find(BranchEntity, { where: { tenantId }, order: { name: 'ASC' } }));
  }
  findBranch(tenantId: string, id: string, manager?: EntityManager): Promise<BranchEntity | null> {
    return this.scope.within(tenantId, manager, (m) => m.findOne(BranchEntity, { where: { tenantId, id } }));
  }
  createBranch(data: Partial<BranchEntity> & { tenantId: string }, manager?: EntityManager): Promise<BranchEntity> {
    return this.scope.within(data.tenantId, manager, (m) => m.save(m.create(BranchEntity, data)));
  }
  saveBranch(entity: BranchEntity): Promise<BranchEntity> {
    return this.scope.run(entity.tenantId, (m) => m.save(entity));
  }
  async deleteBranch(tenantId: string, id: string, manager?: EntityManager): Promise<void> {
    await this.scope.within(tenantId, manager, (m) => m.delete(BranchEntity, { tenantId, id }));
  }

  listDepartments(tenantId: string): Promise<DepartmentEntity[]> {
    return this.scope.run(tenantId, (m) => m.find(DepartmentEntity, { where: { tenantId }, order: { name: 'ASC' } }));
  }
  findDepartment(tenantId: string, id: string): Promise<DepartmentEntity | null> {
    return this.scope.run(tenantId, (m) => m.findOne(DepartmentEntity, { where: { tenantId, id } }));
  }
  createDepartment(data: Partial<DepartmentEntity> & { tenantId: string }): Promise<DepartmentEntity> {
    return this.scope.run(data.tenantId, (m) => m.save(m.create(DepartmentEntity, data)));
  }
  saveDepartment(entity: DepartmentEntity): Promise<DepartmentEntity> {
    return this.scope.run(entity.tenantId, (m) => m.save(entity));
  }
  async deleteDepartment(tenantId: string, id: string): Promise<void> {
    await this.scope.run(tenantId, (m) => m.delete(DepartmentEntity, { tenantId, id }));
  }
}
