import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { REDIS_CLIENT } from '../constants/auth.constants';
import { RedisClient } from '../providers/redis.provider';
import { TotpService } from './totp.service';

const PREFIX = 'roxira:auth:mfa:';
const CHALLENGE_TTL_SECONDS = 300;
const MAX_ATTEMPTS = 5;

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

export interface ChallengeContext {
  ip?: string;
  userAgent?: string;
  tenantId?: string | null;
}

export interface MfaChallenge {
  mfaRequired: true;
  challenge: string;
  expiresIn: number;
}

/**
 * Second step of sign-in for accounts with TOTP. The challenge is an opaque
 * random value kept in Redis (not a JWT, so it can never be used as an access
 * token), valid 5 minutes and 5 attempts.
 */
@Injectable()
export class LoginChallengeService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    private readonly totp: TotpService,
  ) {}

  async needsSecondFactor(userId: string): Promise<boolean> {
    return this.totp.isEnabled(userId);
  }

  async create(userId: string, ctx: ChallengeContext): Promise<MfaChallenge> {
    const challenge = randomBytes(32).toString('base64url');
    await this.redis.set(
      `${PREFIX}${sha256(challenge)}`,
      JSON.stringify({ userId, attempts: 0, ctx }),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return { mfaRequired: true, challenge, expiresIn: CHALLENGE_TTL_SECONDS };
  }

  /** Verify the code; on success the challenge is consumed and the user id + context returned. */
  async complete(challenge: string, code: string): Promise<{ userId: string; ctx: ChallengeContext }> {
    const key = `${PREFIX}${sha256(challenge)}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('Sign-in expired. Start again.');
    const state = JSON.parse(raw) as { userId: string; attempts: number; ctx: ChallengeContext };
    if (state.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new UnauthorizedException('Too many wrong codes. Start again.');
    }
    if (!(await this.totp.verify(state.userId, code))) {
      state.attempts += 1;
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(state), 'EX', ttl > 0 ? ttl : CHALLENGE_TTL_SECONDS);
      throw new UnauthorizedException('That code is not correct.');
    }
    await this.redis.del(key);
    return { userId: state.userId, ctx: state.ctx };
  }
}
