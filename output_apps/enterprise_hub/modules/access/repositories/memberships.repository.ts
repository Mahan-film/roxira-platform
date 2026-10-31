import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MembershipEntity } from '../entities/membership.entity';

export interface MembershipWithUser extends MembershipEntity {
  displayName: string | null;
  loginEmail: string | null;
  username: string | null;
  phone: string | null;
  managed: boolean;
}

export interface MembershipWithTenant {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  roleKey: string;
  status: string;
}

/** Only access point to `tenant_memberships`. Every tenant-scoped method takes tenantId first. */
@Injectable()
export class MembershipsRepository {
  constructor(
    @InjectRepository(MembershipEntity)
    private readonly repo: Repository<MembershipEntity>,
  ) {}

  findByTenantUser(tenantId: string, userId: string): Promise<MembershipEntity | null> {
    return this.repo.findOne({ where: { tenantId, userId } });
  }

  findById(tenantId: string, id: string): Promise<MembershipEntity | null> {
    return this.repo.findOne({ where: { tenantId, id } });
  }

  create(data: Partial<MembershipEntity>): Promise<MembershipEntity> {
    return this.repo.save(this.repo.create(data));
  }

  save(entity: MembershipEntity): Promise<MembershipEntity> {
    return this.repo.save(entity);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.repo.delete({ tenantId, id });
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    return this.repo.count({ where: { tenantId, roleKey: 'owner', status: 'ACTIVE' } });
  }

  async countWithCustomRole(tenantId: string, customRoleId: string): Promise<number> {
    return this.repo.count({ where: { tenantId, customRoleId } });
  }

  /** Members of one organisation joined with their (non-secret) identity. */
  async listByTenant(tenantId: string): Promise<MembershipWithUser[]> {
    const rows = await this.repo
      .createQueryBuilder('m')
      .innerJoin('users', 'u', 'u.id = m.user_id')
      .where('m.tenant_id = :tenantId', { tenantId })
      .select('m.*')
      .addSelect('u."displayName"', 'displayName')
      .addSelect('u.login_email', 'loginEmail')
      .addSelect('u.username', 'username')
      .addSelect('u.phone', 'phone')
      .addSelect('u.managed_by_tenant_id = m.tenant_id', 'managed')
      .orderBy('m.created_at', 'ASC')
      .getRawMany<Record<string, unknown>>();
    return rows.map((r) => ({
      id: r.id as string,
      tenantId: r.tenant_id as string,
      userId: r.user_id as string,
      roleKey: r.role_key as string,
      customRoleId: (r.custom_role_id as string) ?? null,
      branchId: (r.branch_id as string) ?? null,
      departmentId: (r.department_id as string) ?? null,
      branchScoped: r.branch_scoped as boolean,
      status: r.status as MembershipEntity['status'],
      invitedBy: (r.invited_by as string) ?? null,
      createdAt: r.created_at as Date,
      updatedAt: r.updated_at as Date,
      displayName: (r.displayName as string) ?? null,
      loginEmail: (r.loginEmail as string) ?? null,
      username: (r.username as string) ?? null,
      phone: (r.phone as string) ?? null,
      managed: r.managed === true,
    }));
  }

  /** All organisations a user belongs to (for the switcher). Scoped by user, not by tenant. */
  async listForUser(userId: string): Promise<MembershipWithTenant[]> {
    const rows = await this.repo
      .createQueryBuilder('m')
      .innerJoin('tenants', 't', 't.id = m.tenant_id')
      .where('m.user_id = :userId AND t.is_active = true', { userId })
      .select('m.id', 'membershipId')
      .addSelect('m.tenant_id', 'tenantId')
      .addSelect('t.name', 'tenantName')
      .addSelect('m.role_key', 'roleKey')
      .addSelect('m.status', 'status')
      .orderBy('m.created_at', 'ASC')
      .getRawMany<MembershipWithTenant>();
    return rows;
  }
}
