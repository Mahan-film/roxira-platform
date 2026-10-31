import { UnauthorizedException } from '@nestjs/common';
import { InMemoryRefreshTokenRepository } from '../../../test/support/in-memory-auth';
import { UserEntity } from '../entities/user.entity';
import { RefreshTokenService } from './refresh-token.service';

const user = { id: 'u1', tenantId: 't1' } as UserEntity;

const setup = () => {
  const repo = new InMemoryRefreshTokenRepository();
  return { repo, service: new RefreshTokenService(repo as never) };
};

describe('RefreshTokenService', () => {
  it('stores only a hash, with the owner and tenant', async () => {
    const { repo, service } = setup();
    const { token } = await service.issue(user);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ userId: 'u1', tenantId: 't1' });
    expect(repo.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(repo.rows)).not.toContain(token);
  });

  it('consumes a token once and keeps the family for the replacement', async () => {
    const { service } = setup();
    const first = await service.issue(user);
    const { userId, familyId } = await service.consume(first.token);
    expect(userId).toBe('u1');
    const second = await service.issue(user, familyId);
    await expect(service.consume(second.token)).resolves.toMatchObject({ familyId });
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { repo, service } = setup();
    const first = await service.issue(user);
    const { familyId } = await service.consume(first.token);
    const second = await service.issue(user, familyId);
    await expect(service.consume(first.token)).rejects.toBeInstanceOf(UnauthorizedException);
    // the legitimate holder of the newest token is signed out too
    await expect(service.consume(second.token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.rows.every((r) => r.revokedAt)).toBe(true);
  });

  it('rejects unknown and expired tokens with the same error', async () => {
    const { repo, service } = setup();
    await expect(service.consume('x'.repeat(40))).rejects.toThrow('Session expired');
    const { token } = await service.issue(user);
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.consume(token)).rejects.toThrow('Session expired');
  });

  it('logout revokes the family and is idempotent', async () => {
    const { repo, service } = setup();
    const { token } = await service.issue(user);
    await service.revoke(token);
    await service.revoke(token);
    await service.revoke('never-issued-token-value');
    await expect(service.consume(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.rows[0].revokedAt).toBeTruthy();
  });

  it('revokeAllForUser signs out every device', async () => {
    const { repo, service } = setup();
    await service.issue(user);
    await service.issue(user);
    await service.revokeAllForUser('u1');
    expect(repo.rows.every((r) => r.revokedAt)).toBe(true);
  });
});
