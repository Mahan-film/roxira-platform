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
    try {
      const rows = await this.repo.query(
        `SELECT public.is_refresh_token_family_active($1::uuid, $2::uuid) AS active`,
        [familyId, userId],
      );
      if (rows && rows.length > 0) {
        return Boolean(rows[0].active);
      }
    } catch {
      // Fallback: transaction with app.user_id set
      return this.repo.manager.transaction(async (m) => {
        await m.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
        const n = await m.count(RefreshTokenEntity, {
          where: { familyId, userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
        });
        return n > 0;
      });
    }
    return false;
  }
}
