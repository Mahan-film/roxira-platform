import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InvitationEntity } from '../entities/invitation.entity';

/** Invitations. Lookups by token hash are global (the token is the secret); everything else is tenant-scoped. */
@Injectable()
export class InvitationsRepository {
  private readonly logger = new Logger(InvitationsRepository.name);

  constructor(@InjectRepository(InvitationEntity) private readonly repo: Repository<InvitationEntity>) {}

  create(data: Partial<InvitationEntity>): Promise<InvitationEntity> {
    return this.save(this.repo.create(data));
  }

  async findByHash(tokenHash: string): Promise<InvitationEntity | null> {
    try {
      const rows = await this.repo.query(
        `SELECT * FROM public.lookup_invitation_by_token_hash($1)`,
        [tokenHash],
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repo.create({
          id: r.id,
          tenantId: r.tenant_id ?? r.tenantId,
          email: r.email,
          phone: r.phone,
          roleKey: r.role_key ?? r.roleKey,
          customRoleId: r.custom_role_id ?? r.customRoleId,
          branchId: r.branch_id ?? r.branchId,
          departmentId: r.department_id ?? r.departmentId,
          branchScoped: r.branch_scoped ?? r.branchScoped,
          tokenHash: r.token_hash ?? r.tokenHash,
          expiresAt: r.expires_at ?? r.expiresAt,
          acceptedAt: r.accepted_at ?? r.acceptedAt,
          acceptedBy: r.accepted_by ?? r.acceptedBy,
          revokedAt: r.revoked_at ?? r.revokedAt,
          invitedBy: r.invited_by ?? r.invitedBy,
          createdAt: r.created_at ?? r.createdAt,
          updatedAt: r.updated_at ?? r.updatedAt,
        } as InvitationEntity);
      }
      return null;
    } catch (err) {
      this.logger.debug(`lookup_invitation_by_token_hash fallback: ${err}`);
      return this.repo.findOne({ where: { tokenHash } });
    }
  }

  listPending(tenantId: string): Promise<InvitationEntity[]> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.find(InvitationEntity, {
        where: { tenantId, acceptedAt: IsNull(), revokedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
    });
  }

  find(tenantId: string, id: string): Promise<InvitationEntity | null> {
    return this.repo.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.findOne(InvitationEntity, { where: { tenantId, id } });
    });
  }

  save(entity: InvitationEntity): Promise<InvitationEntity> {
    return this.repo.manager.transaction(async (m) => {
      if (entity.tenantId) {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [entity.tenantId]);
      }
      return m.save(entity);
    });
  }

  /** Mark accepted only if still open, so one link cannot be redeemed twice. */
  async markAccepted(id: string, userId: string, tenantId?: string): Promise<boolean> {
    try {
      const rows = await this.repo.query(
        `SELECT public.mark_invitation_accepted($1, $2) AS accepted`,
        [id, userId],
      );
      if (rows && rows.length > 0) {
        return Boolean(rows[0].accepted);
      }
    } catch (err) {
      this.logger.debug(`mark_invitation_accepted fallback: ${err}`);
    }
    return this.repo.manager.transaction(async (m) => {
      if (tenantId) {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      }
      const res = await m.update(
        InvitationEntity,
        { id, acceptedAt: IsNull(), revokedAt: IsNull() },
        { acceptedAt: new Date(), acceptedBy: userId },
      );
      return (res.affected ?? 0) > 0;
    });
  }
}
