import { Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ApiTokenEntity } from '../entities/api-token.entity';

export interface NewApiToken {
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: string[];
  rateLimitPerMinute: number;
  createdBy: string;
  expiresAt: Date | null;
}

/** The only access point to `public_api_tokens` (FORCE RLS: every call runs in a TenantScope). */
@Injectable()
export class ApiTokensRepository {
  constructor(private readonly scope: TenantScope) {}

  create(tenantId: string, input: NewApiToken): Promise<ApiTokenEntity> {
    return this.scope.run(tenantId, (m) => {
      const repo = m.getRepository(ApiTokenEntity);
      return repo.save(repo.create({ ...input, tenantId, revokedAt: null, lastUsedAt: null }));
    });
  }

  list(tenantId: string): Promise<ApiTokenEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ApiTokenEntity).find({ where: { tenantId }, order: { id: 'DESC' } }),
    );
  }

  countActive(tenantId: string): Promise<number> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ApiTokenEntity).count({ where: { tenantId, revokedAt: IsNull() } }),
    );
  }

  findByHash(tenantId: string, tokenHash: string): Promise<ApiTokenEntity | null> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ApiTokenEntity).findOne({ where: { tenantId, tokenHash } }),
    );
  }

  /** Revokes once; returns false when the token does not exist (or is not this tenant's). */
  async revoke(tenantId: string, id: number, at: Date): Promise<boolean> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(ApiTokenEntity);
      const row = await repo.findOne({ where: { tenantId, id } });
      if (!row) return false;
      if (!row.revokedAt) await repo.update({ tenantId, id }, { revokedAt: at });
      return true;
    });
  }

  async touch(tenantId: string, id: number, at: Date): Promise<void> {
    await this.scope.run(tenantId, (m) => m.getRepository(ApiTokenEntity).update({ tenantId, id }, { lastUsedAt: at }));
  }
}
