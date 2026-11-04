import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeRedis } from '../../test/support/fake-redis';
import { ApiTokenGuard, RequireScope } from './guards/api-token.guard';
import { ApiRateLimiter } from './services/api-rate-limiter';
import { ApiTokensService } from './services/api-tokens.service';

class Ctl {
  @RequireScope('items:read') read() {}
  noScope() {}
}

const ctx = (handler: unknown, authorization?: string) => {
  const headers: Record<string, string> = {};
  const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  const res = { setHeader: (k: string, v: string) => void (headers[k] = v) };
  return {
    headers,
    req,
    context: { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as never,
  };
};

describe('ApiTokenGuard', () => {
  const principal = { tenantId: 't', tokenId: 5, scopes: ['items:read'], rateLimitPerMinute: 2 };
  const build = (p: unknown = principal) => {
    const tokens = { authenticate: jest.fn(async () => p) } as unknown as ApiTokensService;
    return new ApiTokenGuard(new Reflector(), tokens, new ApiRateLimiter(new FakeRedis() as never));
  };

  it('needs a Bearer header and a valid token', async () => {
    await expect(build().canActivate(ctx(Ctl.prototype.read).context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(build(null).canActivate(ctx(Ctl.prototype.read, 'Bearer x').context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the principal when the scope matches', async () => {
    const c = ctx(Ctl.prototype.read, 'Bearer x');
    await expect(build().canActivate(c.context)).resolves.toBe(true);
    expect(c.req.apiPrincipal).toEqual(principal);
    expect(c.headers['X-RateLimit-Limit']).toBe('2');
  });

  it('refuses a missing scope and a handler with no scope policy', async () => {
    await expect(build({ ...principal, scopes: ['parties:read'] }).canActivate(ctx(Ctl.prototype.read, 'Bearer x').context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build().canActivate(ctx(Ctl.prototype.noScope, 'Bearer x').context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rate-limits per token: 429 with Retry-After once the limit is passed', async () => {
    const guard = build();
    for (let i = 0; i < 2; i++) await guard.canActivate(ctx(Ctl.prototype.read, 'Bearer x').context);
    const c = ctx(Ctl.prototype.read, 'Bearer x');
    const err = await guard.canActivate(c.context).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(Number(c.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
  });
});
