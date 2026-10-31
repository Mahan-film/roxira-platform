import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, IsNull, Repository } from 'typeorm';
import { RefreshTokenEntity } from '../../auth/entities/refresh-token.entity';

/** Read-only liveness check of a session (refresh-token family) for the access guard. */
@Injectable()
export class SessionCheckRepository {
  constructor(
    @InjectRepository(RefreshTokenEntity) private readonly repo: Repository<RefreshTokenEntity>,
  ) {}

  async isFamilyActive(familyId: string, userId: string): Promise<boolean> {
    const n = await this.repo.count({
      where: { familyId, userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    return n > 0;
  }
}
