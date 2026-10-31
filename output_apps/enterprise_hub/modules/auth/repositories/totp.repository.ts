import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserTotpEntity } from '../entities/user-totp.entity';

/** Only access point to `user_totp` (owner column: user_id). */
@Injectable()
export class TotpRepository {
  constructor(@InjectRepository(UserTotpEntity) private readonly repo: Repository<UserTotpEntity>) {}

  find(userId: string): Promise<UserTotpEntity | null> {
    return this.repo.findOne({ where: { userId } });
  }
  save(entity: Partial<UserTotpEntity>): Promise<UserTotpEntity> {
    return this.repo.save(this.repo.create(entity));
  }
  async remove(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
  /** Compare-and-set the last used step so two parallel requests cannot both accept one code. */
  async advanceStep(userId: string, step: number, previous: string | null): Promise<boolean> {
    const qb = this.repo
      .createQueryBuilder()
      .update()
      .set({ lastUsedStep: String(step) })
      .where('user_id = :userId', { userId });
    if (previous === null) qb.andWhere('last_used_step IS NULL');
    else qb.andWhere('last_used_step = :previous', { previous });
    return ((await qb.execute()).affected ?? 0) > 0;
  }
}
