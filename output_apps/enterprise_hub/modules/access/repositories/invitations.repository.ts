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
          tenantId: r.tenant_id,
          email: r.email,
          phone: r.phone,
          roleKey: r.role_key,
          customRoleId: r.custom_role_id ?? null,
          branchId: r.branch_id ?? null,
          departmentId: r.department_id ?? null,
          branchScoped: r.branch_scoped,
          tokenHash: r.token_hash,
          expiresAt: r.expires_at,
          acceptedAt: r.accepted_at,
          acceptedBy: r.accepted_by,
          revokedAt: r.revoked_at,
          invitedBy: r.invited_by,
          createdAt: r.created_at,
        } as InvitationEntity);
      }
      return null;
    } catch (err) {
      this.logger.error(`lookup_invitation_by_token_hash error: ${err}`);
      throw err;
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
      return false;
    } catch (err) {
      this.logger.error(`mark_invitation_accepted error: ${err}`);
      throw err;
    }
  }
}
