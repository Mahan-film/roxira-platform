import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(MembershipsRepository.name);

  constructor(
    @InjectRepository(MembershipEntity)
    private readonly repo: Repository<MembershipEntity>,
  ) {}

  findByTenantUser(tenantId: string, userId: string): Promise<MembershipEntity | null> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.findOne(MembershipEntity, { where: { tenantId, userId } });
    });
  }

  findById(tenantId: string, id: string): Promise<MembershipEntity | null> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.findOne(MembershipEntity, { where: { tenantId, id } });
    });
  }

  create(data: Partial<MembershipEntity>): Promise<MembershipEntity> {
    return this.save(this.repo.create(data));
  }

  async save(entity: MembershipEntity): Promise<MembershipEntity> {
    if (!entity.tenantId) {
      throw new Error('Cannot save membership without tenantId');
    }
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [entity.tenantId]);
      return m.save(entity);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await m.delete(MembershipEntity, { tenantId, id });
    });
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.count(MembershipEntity, { where: { tenantId, roleKey: 'owner', status: 'ACTIVE' } });
    });
  }

  async countWithCustomRole(tenantId: string, customRoleId: string): Promise<number> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.count(MembershipEntity, { where: { tenantId, customRoleId } });
    });
  }

  /** Members of one organisation joined with their (non-secret) identity. */
  async listByTenant(tenantId: string): Promise<MembershipWithUser[]> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const rows = await m
        .createQueryBuilder(MembershipEntity, 'm')
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
    });
  }

  /** All organisations a user belongs to (for the switcher). Scoped by caller user context. */
  async listForUser(userId: string, callerUserId?: string): Promise<MembershipWithTenant[]> {
    try {
      const rows = callerUserId
        ? await this.repo.manager.transaction(async (m) => {
            await m.query(`SELECT set_config('app.user_id', $1, true)`, [callerUserId]);
            return m.query(
              `SELECT * FROM public.lookup_user_memberships($1)`,
              [userId],
            );
          })
        : await this.repo.query(
            `SELECT * FROM public.lookup_user_memberships($1)`,
            [userId],
          );
      if (rows) {
        return rows.map((r: any) => ({
          membershipId: r.membership_id,
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          roleKey: r.role_key,
          status: r.status,
        }));
      }
      return [];
    } catch (err) {
      this.logger.error(`lookup_user_memberships error for ${userId}: ${err}`);
      throw err;
    }
  }
}
