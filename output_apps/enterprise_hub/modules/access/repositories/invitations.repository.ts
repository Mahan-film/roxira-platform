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
  findByHash(tokenHash: string): Promise<InvitationEntity | null> {
    return this.repo.findOne({ where: { tokenHash } });
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
