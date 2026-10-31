import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  REFRESH_INVALID_ERROR,
  REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../constants/password-auth.constants';
import { UserEntity } from '../entities/user.entity';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';

export interface IssuedRefreshToken {
  token: string;
  expiresIn: number;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string;
}

/** Session metadata stored with each refresh token and carried through rotation. */
export interface SessionMeta {
  tenantId?: string | null;
  mfa?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  deviceHash?: string | null;
  sessionStartedAt?: Date | null;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * Refresh-token lifecycle: issue, rotate on every use, revoke on logout or
 * password change. Raw tokens are random (384 bits) and never stored; only
 * their SHA-256 is. Replaying an already-rotated token kills the whole family.
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly repository: RefreshTokenRepository) {}

  async issue(
    user: UserEntity,
    familyId: string = randomUUID(),
    meta: SessionMeta = {},
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    await this.repository.create({
      userId: user.id,
      tenantId: meta.tenantId === undefined ? (user.tenantId ?? null) : meta.tenantId,
      mfa: meta.mfa ?? false,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 255) : null,
      deviceHash: meta.deviceHash ?? null,
      sessionStartedAt: meta.sessionStartedAt ?? new Date(),
      tokenHash: sha256(token),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      revokedAt: null,
    });
    return { token, expiresIn: REFRESH_TOKEN_TTL_SECONDS };
  }

  /**
   * Exchange a refresh token for the user id it belongs to and revoke it.
   * The caller must then issue a replacement with `issue(user, familyId)`.
   */
  async consume(rawToken: string): Promise<{ userId: string; familyId: string; meta: SessionMeta }> {
    const record = await this.repository.findByHash(sha256(rawToken));
    if (!record) {
      throw new UnauthorizedException(REFRESH_INVALID_ERROR);
    }
    if (record.revokedAt) {
      // A rotated token came back: assume theft and drop the family.
      await this.repository.revokeFamily(record.familyId);
      throw new UnauthorizedException(REFRESH_INVALID_ERROR);
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(REFRESH_INVALID_ERROR);
    }
    if (!(await this.repository.revokeIfActive(record.id))) {
      // Lost a race with a parallel refresh of the same token.
      await this.repository.revokeFamily(record.familyId);
      throw new UnauthorizedException(REFRESH_INVALID_ERROR);
    }
    return {
      userId: record.userId,
      familyId: record.familyId,
      meta: {
        tenantId: record.tenantId,
        mfa: record.mfa,
        ip: record.ip,
        userAgent: record.userAgent,
        deviceHash: record.deviceHash,
        sessionStartedAt: record.sessionStartedAt,
      },
    };
  }

  /** Logout: revoke the token's whole family. Unknown tokens are ignored (idempotent). */
  async revoke(rawToken: string): Promise<void> {
    const record = await this.repository.findByHash(sha256(rawToken));
    if (record) {
      await this.repository.revokeFamily(record.familyId);
    }
  }

  /** Session list and management for the owner of the sessions. */
  listActive(userId: string) {
    return this.repository.listActiveForUser(userId);
  }
  revokeSession(userId: string, familyId: string) {
    return this.repository.revokeFamilyForUser(userId, familyId);
  }
  revokeOthers(userId: string, keepFamilyId: string) {
    return this.repository.revokeOtherFamilies(userId, keepFamilyId);
  }
  setSessionTenant(userId: string, familyId: string, tenantId: string) {
    return this.repository.setFamilyTenant(userId, familyId, tenantId);
  }
  markSessionMfa(userId: string, familyId: string) {
    return this.repository.setFamilyMfa(userId, familyId);
  }
  async isNewDevice(userId: string, deviceHash: string): Promise<boolean> {
    return (await this.repository.hasAnySession(userId)) && !(await this.repository.hasDevice(userId, deviceHash));
  }

  revokeAllForUser(userId: string): Promise<void> {
    return this.repository.revokeAllForUser(userId);
  }
}
