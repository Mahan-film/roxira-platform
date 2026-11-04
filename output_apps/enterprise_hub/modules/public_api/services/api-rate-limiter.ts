import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PUBLIC_API_REDIS, RATE_WINDOW_SECONDS } from '../constants/public-api.constants';

const COUNT_IN_WINDOW_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window counter per token (one key per token and minute), shared across backend instances. */
@Injectable()
export class ApiRateLimiter {
  constructor(@Inject(PUBLIC_API_REDIS) private readonly redis: Redis) {}

  async hit(tokenId: number, limit: number, nowMs = Date.now()): Promise<RateDecision> {
    const windowMs = RATE_WINDOW_SECONDS * 1000;
    const bucket = Math.floor(nowMs / windowMs);
    const key = `public_api:rl:${tokenId}:${bucket}`;
    const count = Number(await this.redis.eval(COUNT_IN_WINDOW_LUA, 1, key, RATE_WINDOW_SECONDS));
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(((bucket + 1) * windowMs - nowMs) / 1000)),
    };
  }
}
