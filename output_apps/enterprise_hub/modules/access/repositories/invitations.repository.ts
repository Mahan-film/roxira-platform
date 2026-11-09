import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InvitationEntity } from '../entities/invitation.entity';

/** Invitations. Lookups by token hash are global (the token is the secret); everything else is tenant-scoped. */
@Injectable()
export class InvitationsRepository {
  constructor(@InjectRepository(InvitationEntity) private readonly repo: Repository<InvitationEntity>) {}

  create(data: Partial<InvitationEntity>): Promise<InvitationEntity> {
    return this.repo.save(this.repo.create(data));
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
        } as InvitationEntity);
      }
      return null;
    } catch {
      return this.repo.findOne({ where: { tokenHash } });
    }
  }
  listPending(tenantId: string): Promise<InvitationEntity[]> {
    return this.repo.find({
      where: { tenantId, acceptedAt: IsNull(), revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }
  find(tenantId: string, id: string): Promise<InvitationEntity | null> {
    return this.repo.findOne({ where: { tenantId, id } });
  }
  save(entity: InvitationEntity): Promise<InvitationEntity> {
    return this.repo.save(entity);
  }
  /** Mark accepted only if still open, so one link cannot be redeemed twice. */
  async markAccepted(id: string, userId: string): Promise<boolean> {
    const res = await this.repo.update(
      { id, acceptedAt: IsNull(), revokedAt: IsNull() },
      { acceptedAt: new Date(), acceptedBy: userId },
    );
    return (res.affected ?? 0) > 0;
  }
}
