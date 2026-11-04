import type Redis from 'ioredis';
import { ApiRateLimiter } from './api-rate-limiter';
import { RATE_WINDOW_SECONDS } from '../constants/public-api.constants';

/**
 * In-memory stand-in for the injected Redis client. It emulates exactly the
 * Lua script in api-rate-limiter.ts: `INCR key`, then `EXPIRE key window` on
 * the first hit, returning the new counter value.
 */
function createFakeRedis(): Redis {
  const store = new Map<string, number>();
  return {
    eval: async (_script: string, _numKeys: number, key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
  } as unknown as Redis;
}

describe('ApiRateLimiter', () => {
  let limiter: ApiRateLimiter;
  let redis: Redis;
  const tokenId = 123;
  const limit = 5;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    redis = createFakeRedis();
    limiter = new ApiRateLimiter(redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < limit; i++) {
      const decision = await limiter.hit(tokenId, limit);
      expect(decision.allowed).toBe(true);
    }
  });

  it('refuses the (limit+1)th request in the window', async () => {
    let decision;
    for (let i = 0; i < limit + 1; i++) {
      decision = await limiter.hit(tokenId, limit);
    }
    expect(decision!.allowed).toBe(false);
  });

  it('allows the request exactly at the limit', async () => {
    let decision;
    for (let i = 0; i < limit; i++) {
      decision = await limiter.hit(tokenId, limit);
    }
    expect(decision!.allowed).toBe(true);
  });

  it('resets the window after RATE_WINDOW_SECONDS using fake timers', async () => {
    for (let i = 0; i < limit; i++) {
      await limiter.hit(tokenId, limit);
    }
    const blocked = await limiter.hit(tokenId, limit);
    expect(blocked.allowed).toBe(false);

    jest.advanceTimersByTime(RATE_WINDOW_SECONDS * 1000);

    const afterReset = await limiter.hit(tokenId, limit);
    expect(afterReset.allowed).toBe(true);
  });

  it('does not share a bucket between two tokens', async () => {
    const otherTokenId = 456;

    for (let i = 0; i < limit; i++) {
      await limiter.hit(tokenId, limit);
    }
    const exhausted = await limiter.hit(tokenId, limit);
    expect(exhausted.allowed).toBe(false);

    const otherDecision = await limiter.hit(otherTokenId, limit);
    expect(otherDecision.allowed).toBe(true);
    expect(otherDecision.remaining).toBe(limit - 1);
  });

  it('reports the correct remaining count as the counter grows', async () => {
    const first = await limiter.hit(tokenId, limit);
    expect(first.remaining).toBe(limit - 1);

    const second = await limiter.hit(tokenId, limit);
    expect(second.remaining).toBe(limit - 2);
  });

  it('returns at least one second in retryAfterSeconds once blocked', async () => {
    for (let i = 0; i < limit + 1; i++) {
      await limiter.hit(tokenId, limit);
    }
    const decision = await limiter.hit(tokenId, limit);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(RATE_WINDOW_SECONDS);
  });

  it('echoes the configured limit in the decision', async () => {
    const decision = await limiter.hit(tokenId, 9);
    expect(decision.limit).toBe(9);
    expect(decision.allowed).toBe(true);
  });
});
