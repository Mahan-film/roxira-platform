import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessContext } from '../access-context';
import { BranchEntity } from '../entities/branch.entity';
import { DepartmentEntity } from '../entities/department.entity';
import { StructureRepository } from '../repositories/structure.repository';
import { AuditService } from './audit.service';

type Req = Parameters<AuditService['record']>[0]['request'];

@Injectable()
export class StructureService {
  constructor(
    private readonly repo: StructureRepository,
    private readonly audit: AuditService,
  ) {}

  listBranches(ctx: AccessContext): Promise<BranchEntity[]> {
    return this.repo.listBranches(ctx.tenantId);
  }
  listDepartments(ctx: AccessContext): Promise<DepartmentEntity[]> {
    return this.repo.listDepartments(ctx.tenantId);
  }

  async createBranch(ctx: AccessContext, dto: { name: string; code?: string; parentId?: string }, request?: Req): Promise<BranchEntity> {
    if (dto.parentId && !(await this.repo.findBranch(ctx.tenantId, dto.parentId))) {
      throw new BadRequestException('Parent branch does not belong to this organisation.');
    }
    const b = await this.repo.createBranch({ tenantId: ctx.tenantId, name: dto.name.trim(), code: dto.code ?? null, parentId: dto.parentId ?? null });
    await this.audit.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'branch.create', resourceType: 'branch', resourceId: b.id, request });
    return b;
  }

  async updateBranch(ctx: AccessContext, id: string, dto: { name?: string; code?: string }, request?: Req): Promise<BranchEntity> {
    const b = await this.repo.findBranch(ctx.tenantId, id);
    if (!b) throw new NotFoundException('Branch not found.');
    if (dto.name !== undefined) b.name = dto.name.trim();
    if (dto.code !== undefined) b.code = dto.code;
    const saved = await this.repo.saveBranch(b);
    await this.audit.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'branch.update', resourceType: 'branch', resourceId: id, request });
    return saved;
  }

  async deleteBranch(ctx: AccessContext, id: string, request?: Req): Promise<void> {
    if (!(await this.repo.findBranch(ctx.tenantId, id))) throw new NotFoundException('Branch not found.');
    await this.repo.deleteBranch(ctx.tenantId, id);
    await this.audit.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'branch.delete', resourceType: 'branch', resourceId: id, request });
  }

  async createDepartment(ctx: AccessContext, dto: { name: string; branchId?: string }, request?: Req): Promise<DepartmentEntity> {
    if (dto.branchId && !(await this.repo.findBranch(ctx.tenantId, dto.branchId))) {
      throw new BadRequestException('Branch does not belong to this organisation.');
    }
    const d = await this.repo.createDepartment({ tenantId: ctx.tenantId, name: dto.name.trim(), branchId: dto.branchId ?? null });
    await this.audit.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'department.create', resourceType: 'department', resourceId: d.id, request });
    return d;
  }

  async deleteDepartment(ctx: AccessContext, id: string, request?: Req): Promise<void> {
    if (!(await this.repo.findDepartment(ctx.tenantId, id))) throw new NotFoundException('Department not found.');
    await this.repo.deleteDepartment(ctx.tenantId, id);
    await this.audit.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'department.delete', resourceType: 'department', resourceId: id, request });
  }
}
