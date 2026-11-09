import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';

/** Only access point to `auth_refresh_tokens` (Repository pattern, AGENTS.md rule 3). */
@Injectable()
export class RefreshTokenRepository {
  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly repository: Repository<RefreshTokenEntity>,
  ) {}

  create(data: Partial<RefreshTokenEntity>): Promise<RefreshTokenEntity> {
    return this.repository.save(this.repository.create(data));
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenEntity | null> {
    try {
      const rows = await this.repository.query(
        `SELECT * FROM public.lookup_refresh_token_by_hash($1)`,
        [tokenHash],
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repository.create({
          id: r.id,
          userId: r.user_id ?? r.userId,
          tenantId: r.tenant_id ?? r.tenantId,
          tokenHash: r.token_hash ?? r.tokenHash,
          familyId: r.family_id ?? r.familyId,
          userAgent: r.user_agent ?? r.userAgent,
          ip: r.ip,
          deviceHash: r.device_hash ?? r.deviceHash,
          mfa: r.mfa,
          sessionStartedAt: r.session_started_at ?? r.sessionStartedAt,
          expiresAt: r.expires_at ?? r.expiresAt,
          revokedAt: r.revoked_at ?? r.revokedAt,
          createdAt: r.created_at ?? r.createdAt,
        } as RefreshTokenEntity);
      }
      return null;
    } catch {
      return this.repository.findOne({ where: { tokenHash } });
    }
  }

  /**
   * Revoke one token only if it is still active. Returns true when this call
   * did the revoking, so two parallel refreshes cannot both rotate the token.
   */
  async revokeIfActive(id: string): Promise<boolean> {
    const result = await this.repository.update(
      { id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.repository.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Housekeeping: drop rows that expired more than a day ago. */
  async deleteExpired(now = new Date()): Promise<void> {
    await this.repository.delete({
      expiresAt: LessThan(new Date(now.getTime() - 24 * 3600 * 1000)),
    });
  }

  /** One active row per live session (rotation revokes the previous row). */
  listActiveForUser(userId: string): Promise<RefreshTokenEntity[]> {
    return this.repository.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
  }

  /** Revoke one session of this user only; returns whether anything was revoked. */
  async revokeFamilyForUser(userId: string, familyId: string): Promise<boolean> {
    const res = await this.repository.update({ userId, familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
    return (res.affected ?? 0) > 0;
  }

  async revokeOtherFamilies(userId: string, keepFamilyId: string): Promise<number> {
    const res = await this.repository.update(
      { userId, familyId: Not(keepFamilyId), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return res.affected ?? 0;
  }

  async setFamilyTenant(userId: string, familyId: string, tenantId: string): Promise<void> {
    await this.repository.update({ userId, familyId, revokedAt: IsNull() }, { tenantId });
  }

  async setFamilyMfa(userId: string, familyId: string): Promise<void> {
    await this.repository.update({ userId, familyId, revokedAt: IsNull() }, { mfa: true });
  }

  /** Has this user ever signed in from this device fingerprint? */
  async hasDevice(userId: string, deviceHash: string): Promise<boolean> {
    return (await this.repository.count({ where: { userId, deviceHash } })) > 0;
  }

  async hasAnySession(userId: string): Promise<boolean> {
    return (await this.repository.count({ where: { userId } })) > 0;
  }
}
