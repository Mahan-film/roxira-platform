import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { IdempotencyKeyEntity, IdempotencyKeyStatus } from '../entities/idempotency-key.entity';

export interface AcquireIdempotencyInput {
  tenantId: string;
  scopeHash: string;
  idempotencyKey: string;
  fingerprint: string;
  expiresAt: Date;
}

export type AcquireIdempotencyResult =
  | { acquired: true; record: IdempotencyKeyEntity }
  | { acquired: false; existing: IdempotencyKeyEntity };

/**
 * Tenant-scoped persistence for `sys_idempotency_keys`.
 *
 * Every query executes inside `TenantScope` (sets `app.tenant_id` for FORCE RLS) and never
 * swallows database errors or falls back to in-process maps.
 */
@Injectable()
export class IdempotencyRepository {
  constructor(private readonly scope: TenantScope) {}

  /**
   * Atomically claims `(tenantId, scopeHash, idempotencyKey)` as `IN_PROGRESS` before handler
   * execution so concurrent first requests cannot double-execute and the first record's
   * fingerprint/response is never overwritten. Expired rows for the same tuple are pruned first.
   */
  async tryAcquire(
    input: AcquireIdempotencyInput,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<AcquireIdempotencyResult> {
    const key = input.idempotencyKey.trim();
    return this.scope.within(input.tenantId, manager, async (m) => {
      // Remove an expired record for this exact key so reuse after TTL (> 24 h) starts cleanly.
      await m
        .createQueryBuilder()
        .delete()
        .from(IdempotencyKeyEntity)
        .where(
          'tenant_id = :tenantId AND scope_hash = :scopeHash AND idempotency_key = :key AND expires_at <= :now',
          { tenantId: input.tenantId, scopeHash: input.scopeHash, key, now },
        )
        .execute();

      const inserted = await m
        .createQueryBuilder()
        .insert()
        .into(IdempotencyKeyEntity)
        .values({
          tenantId: input.tenantId,
          scopeHash: input.scopeHash,
          idempotencyKey: key,
          fingerprint: input.fingerprint,
          status: IdempotencyKeyStatus.IN_PROGRESS,
          responseStatus: null,
          responseBody: null as never,
          expiresAt: input.expiresAt,
        })
        .orIgnore()
        .returning('*')
        .execute();

      const raw = inserted.raw?.[0];
      if (raw) {
        return { acquired: true, record: this.hydrate(raw) };
      }

      const existing = await m.getRepository(IdempotencyKeyEntity).findOne({
        where: {
          tenantId: input.tenantId,
          scopeHash: input.scopeHash,
          idempotencyKey: key,
        },
      });
      if (!existing) {
        throw new Error('Idempotency key vanished concurrently during acquire.');
      }
      return { acquired: false, existing };
    });
  }

  async findActive(
    tenantId: string,
    scopeHash: string,
    idempotencyKey: string,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<IdempotencyKeyEntity | null> {
    const key = idempotencyKey.trim();
    if (!key) return null;
    return this.scope.within(tenantId, manager, async (m) => {
      return m
        .getRepository(IdempotencyKeyEntity)
        .createQueryBuilder('k')
        .where('k.tenantId = :tenantId', { tenantId })
        .andWhere('k.scopeHash = :scopeHash', { scopeHash })
        .andWhere('k.idempotencyKey = :key', { key })
        .andWhere('k.expiresAt > :now', { now })
        .getOne();
    });
  }

  /**
   * Transitions an `IN_PROGRESS` record to `COMPLETED` once. Never overwrites a completed record.
   */
  async complete(
    tenantId: string,
    id: string,
    responseStatus: number,
    responseBody: unknown,
    manager?: EntityManager,
  ): Promise<boolean> {
    const serializedBody =
      responseBody === undefined || responseBody === null
        ? null
        : typeof responseBody === 'string'
          ? responseBody
          : JSON.stringify(responseBody);

    return this.scope.within(tenantId, manager, async (m) => {
      const res = await m
        .createQueryBuilder()
        .update(IdempotencyKeyEntity)
        .set({
          status: IdempotencyKeyStatus.COMPLETED,
          responseStatus,
          responseBody: serializedBody,
        })
        .where('id = :id AND tenant_id = :tenantId AND status = :inProgress', {
          id,
          tenantId,
          inProgress: IdempotencyKeyStatus.IN_PROGRESS,
        })
        .execute();
      return (res.affected ?? 0) === 1;
    });
  }

  /** Releases an `IN_PROGRESS` lock if the handler failed before producing a cacheable response. */
  async releaseInProgress(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.scope.within(tenantId, manager, async (m) => {
      await m
        .createQueryBuilder()
        .delete()
        .from(IdempotencyKeyEntity)
        .where('id = :id AND tenant_id = :tenantId AND status = :inProgress', {
          id,
          tenantId,
          inProgress: IdempotencyKeyStatus.IN_PROGRESS,
        })
        .execute();
    });
  }

  /** Deletes expired rows strictly within `tenantId`. Returns number of purged rows. */
  async purgeExpired(
    tenantId: string,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<number> {
    return this.scope.within(tenantId, manager, async (m) => {
      const res = await m
        .createQueryBuilder()
        .delete()
        .from(IdempotencyKeyEntity)
        .where('tenant_id = :tenantId AND expires_at <= :now', { tenantId, now })
        .execute();
      return res.affected ?? 0;
    });
  }

  private hydrate(raw: Record<string, unknown>): IdempotencyKeyEntity {
    const e = new IdempotencyKeyEntity();
    e.id = String(raw.id);
    e.tenantId = String(raw.tenant_id);
    e.scopeHash = String(raw.scope_hash);
    e.idempotencyKey = String(raw.idempotency_key);
    e.fingerprint = String(raw.fingerprint);
    e.status = raw.status as IdempotencyKeyStatus;
    e.responseStatus = raw.response_status != null ? Number(raw.response_status) : null;
    e.responseBody = raw.response_body != null ? String(raw.response_body) : null;
    e.createdAt = raw.created_at instanceof Date ? raw.created_at : new Date(String(raw.created_at));
    e.expiresAt = raw.expires_at instanceof Date ? raw.expires_at : new Date(String(raw.expires_at));
    return e;
  }
}
