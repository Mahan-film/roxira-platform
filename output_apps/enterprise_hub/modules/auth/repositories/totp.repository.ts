import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserTotpEntity } from '../entities/user-totp.entity';

/** Only access point to `user_totp` (owner column: user_id). */
@Injectable()
export class TotpRepository {
  constructor(@InjectRepository(UserTotpEntity) private readonly repo: Repository<UserTotpEntity>) {}

  private withUserScope<T>(userId: string, fn: (repo: Repository<UserTotpEntity>) => Promise<T>): Promise<T> {
    return this.repo.manager.transaction(async (em) => {
      await em.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      return fn(em.getRepository(UserTotpEntity));
    });
  }

  find(userId: string): Promise<UserTotpEntity | null> {
    return this.withUserScope(userId, (r) => r.findOne({ where: { userId } }));
  }
  save(entity: Partial<UserTotpEntity>): Promise<UserTotpEntity> {
    if (!entity.userId) {
      throw new Error('TotpRepository.save requires userId for RLS scope');
    }
    return this.withUserScope(entity.userId, (r) => r.save(r.create(entity)));
  }
  async remove(userId: string): Promise<void> {
    await this.withUserScope(userId, (r) => r.delete({ userId }));
  }
  /** Compare-and-set the last used step so two parallel requests cannot both accept one code. */
  async advanceStep(userId: string, step: number, previous: string | null): Promise<boolean> {
    return this.withUserScope(userId, async (r) => {
      const qb = r
        .createQueryBuilder()
        .update()
        .set({ lastUsedStep: String(step) })
        .where('user_id = :userId', { userId });
      if (previous === null) qb.andWhere('last_used_step IS NULL');
      else qb.andWhere('last_used_step = :previous', { previous });
      return ((await qb.execute()).affected ?? 0) > 0;
    });
  }
}
