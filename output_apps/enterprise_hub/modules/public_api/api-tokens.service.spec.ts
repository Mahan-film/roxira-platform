import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MAX_ACTIVE_TOKENS_PER_TENANT, TOKEN_REGEX } from './constants/public-api.constants';
import { ApiTokenEntity } from './entities/api-token.entity';
import { ApiTokensRepository } from './repositories/api-tokens.repository';
import { ApiTokensService, hashToken } from './services/api-tokens.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

/** In-memory repository with the same tenant filtering the real one gets from SQL + RLS. */
class FakeRepo {
  rows: ApiTokenEntity[] = [];
  touched: number[] = [];
  async create(tenantId: string, input: Partial<ApiTokenEntity>) {
    const row = { id: this.rows.length + 1, tenantId, revokedAt: null, lastUsedAt: null, createdAt: new Date(), ...input } as ApiTokenEntity;
    this.rows.push(row);
    return row;
  }
  async list(tenantId: string) { return this.rows.filter((r) => r.tenantId === tenantId); }
  async countActive(tenantId: string) { return this.rows.filter((r) => r.tenantId === tenantId && !r.revokedAt).length; }
  async findByHash(tenantId: string, h: string) { return this.rows.find((r) => r.tenantId === tenantId && r.tokenHash === h) ?? null; }
  async revoke(tenantId: string, id: number, at: Date) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id);
    if (!r) return false;
    r.revokedAt ??= at;
    return true;
  }
  async touch(_t: string, id: number) { this.touched.push(id); }
}

describe('ApiTokensService', () => {
  let repo: FakeRepo;
  let service: ApiTokensService;
  beforeEach(() => {
    repo = new FakeRepo();
    service = new ApiTokensService(repo as unknown as ApiTokensRepository);
  });

  it('shows the token once and stores only its hash', async () => {
    const created = await service.create(T1, 'user-1', { name: 'shop', scopes: ['items:read'] });
    expect(created.token).toMatch(TOKEN_REGEX);
    expect(created.token.includes(T1)).toBe(true);
    const stored = repo.rows[0];
    expect(stored.tokenHash).toBe(hashToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    const listed = await service.list(T1);
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(listed[0]).not.toHaveProperty('token');
  });

  it('authenticates a valid token and returns the tenant, scopes and rate limit', async () => {
    const { token } = await service.create(T1, 'u', { name: 'a', scopes: ['items:read', 'invoices:write'], rateLimitPerMinute: 7 });
    expect(await service.authenticate(token)).toMatchObject({ tenantId: T1, scopes: ['items:read', 'invoices:write'], rateLimitPerMinute: 7 });
  });

  it('rejects malformed, unknown, revoked and expired tokens', async () => {
    const { token } = await service.create(T1, 'u', { name: 'a', scopes: ['items:read'] });
    expect(await service.authenticate('nope')).toBeNull();
    expect(await service.authenticate(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull();
    // a valid-looking token whose tenant segment was swapped does not match any hash
    expect(await service.authenticate(token.replace(T1, T2))).toBeNull();
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);
    expect(await service.authenticate(token)).toBeNull();
    repo.rows[0].expiresAt = null;
    await service.revoke(T1, 1);
    expect(await service.authenticate(token)).toBeNull();
  });

  it('revoke is tenant-scoped', async () => {
    await service.create(T1, 'u', { name: 'a', scopes: ['items:read'] });
    await expect(service.revoke(T2, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.rows[0].revokedAt).toBeNull();
  });

  it('refreshes last_used_at at most once a minute', async () => {
    const { token } = await service.create(T1, 'u', { name: 'a', scopes: ['items:read'] });
    const now = new Date();
    await service.authenticate(token, now);
    repo.rows[0].lastUsedAt = now;
    await service.authenticate(token, new Date(now.getTime() + 5000));
    await new Promise((r) => setImmediate(r));
    expect(repo.touched).toEqual([1]);
  });

  it('caps active tokens and refuses past expiry dates', async () => {
    await expect(service.create(T1, 'u', { name: 'a', scopes: ['items:read'], expiresAt: '2000-01-01T00:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
    for (let i = 0; i < MAX_ACTIVE_TOKENS_PER_TENANT; i++) await service.create(T1, 'u', { name: `t${i}`, scopes: ['items:read'] });
    await expect(service.create(T1, 'u', { name: 'x', scopes: ['items:read'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(T2, 'u', { name: 'x', scopes: ['items:read'] })).resolves.toBeDefined();
  });
});
