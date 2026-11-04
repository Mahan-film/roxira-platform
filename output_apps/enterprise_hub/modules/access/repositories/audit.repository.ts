import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { AuditLogEntity } from '../entities/audit-log.entity';
import { TenantScope } from '../services/tenant-scope';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

export const GENESIS_HASH = '0'.repeat(64);

/** JSON with sorted keys: jsonb does not keep key order, so the hash must not depend on it. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Canonical text of a row; the hash covers everything that matters, in a fixed order. */
export function auditRowHash(prev: string, r: {
  tenantId: string | null; actorUserId: string | null; action: string; resourceType: string | null;
  resourceId: string | null; metadata: unknown; ip: string | null; userAgent: string | null; createdAt: Date;
}): string {
  const body = stableStringify([
    r.tenantId, r.actorUserId, r.action, r.resourceType, r.resourceId,
    r.metadata ?? null, r.ip, r.userAgent, r.createdAt.toISOString(),
  ]);
  return createHash('sha256').update(`${prev}|${body}`).digest('hex');
}

/**
 * Append and read only; there is deliberately no update or delete. Rows of a
 * tenant form a hash chain (each row hashes the previous row's hash), appended
 * under a per-tenant advisory lock so concurrent writers cannot fork it.
 */
@Injectable()
export class AuditRepository {
  constructor(
    private readonly scope: TenantScope,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * With `manager` the row joins the caller's transaction (inside a savepoint, so a failed audit write
   * cannot abort the caller's work) and commits or rolls back together with it.
   */
  async append(data: Partial<AuditLogEntity>, manager?: EntityManager): Promise<void> {
    const createdAt = new Date();
    const row = {
      tenantId: data.tenantId ?? null,
      actorUserId: data.actorUserId ?? null,
      action: data.action as string,
      resourceType: data.resourceType ?? null,
      resourceId: data.resourceId ?? null,
      metadata: data.metadata ?? null,
      ip: data.ip ?? null,
      userAgent: data.userAgent ?? null,
      createdAt,
    };
    if (!row.tenantId) {
      // Tenant-less events (failed logins of unknown accounts, ...) are not chained.
      await this.dataSource.transaction((m) => this.insert(m, { ...row, prevHash: null, hash: auditRowHash(GENESIS_HASH, row) }));
      return;
    }
    const write = async (m: EntityManager) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`audit:${row.tenantId}`]);
      const last = (await m.query(
        `SELECT "hash" FROM "audit_log" WHERE "tenant_id" = $1 AND "hash" IS NOT NULL ORDER BY "id" DESC LIMIT 1`,
        [row.tenantId],
      )) as Array<{ hash: string }>;
      const prev = last[0]?.hash ?? GENESIS_HASH;
      await this.insert(m, { ...row, prevHash: prev, hash: auditRowHash(prev, row) });
    };
    if (manager) await this.scope.within(row.tenantId, manager, (m) => m.transaction(write));
    else await this.scope.run(row.tenantId, write);
  }

  /** No RETURNING: under FORCE RLS it needs the read policy, which tenant-less rows do not pass. */
  private async insert(m: EntityManager, r: Partial<AuditLogEntity>): Promise<void> {
    await m.createQueryBuilder().insert().into(AuditLogEntity).values(r as never).updateEntity(false).execute();
  }

  listForTenant(
    tenantId: string,
    opts: { limit: number; beforeId?: string; action?: string; actorUserId?: string },
  ): Promise<AuditLogEntity[]> {
    return this.scope.run(tenantId, (m) => {
      const qb = m
        .createQueryBuilder(AuditLogEntity, 'a')
        .where('a.tenant_id = :tenantId', { tenantId })
        .orderBy('a.id', 'DESC')
        .limit(opts.limit);
      if (opts.beforeId) qb.andWhere('a.id < :beforeId', { beforeId: opts.beforeId });
      if (opts.action) qb.andWhere('a.action = :action', { action: opts.action });
      if (opts.actorUserId) qb.andWhere('a.actor_user_id = :actor', { actor: opts.actorUserId });
      return qb.getMany();
    });
  }

  /**
   * Walk the tenant's chain oldest-first and report the first row that does not match. Ledger events
   * are in the same chain; each one is also checked against the ledger table it points to, so a
   * journal entry or period lock that was removed (or renumbered) behind the application's back is
   * reported in `ledgerMissing` even though the chain itself is intact.
   */
  verifyChain(tenantId: string): Promise<{
    ok: boolean; checked: number; brokenAtId: string | null; ledgerEvents: number; ledgerMissing: string[];
  }> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.find(AuditLogEntity, { where: { tenantId }, order: { id: 'ASC' } });
      let prev = GENESIS_HASH;
      let checked = 0;
      let ledgerEvents = 0;
      for (const r of rows) {
        if (r.action.startsWith('ledger.')) ledgerEvents += 1;
        if (!r.hash) continue;
        const expected = auditRowHash(prev, { ...r, createdAt: new Date(r.createdAt) });
        if (r.prevHash !== prev || r.hash !== expected) {
          return { ok: false, checked, brokenAtId: r.id, ledgerEvents, ledgerMissing: [] };
        }
        prev = r.hash;
        checked += 1;
      }
      const missing = (await m.query(
        `SELECT a.id::text AS id FROM audit_log a
          LEFT JOIN fin_journal_entries e ON a.resource_type = 'journal_entry' AND e.tenant_id = a.tenant_id
                AND e.id::text = a.resource_id AND e.entry_number = a.metadata->>'entryNumber'
          LEFT JOIN fin_period_locks l ON a.resource_type = 'period_lock' AND l.tenant_id = a.tenant_id
                AND l.id::text = a.resource_id
          WHERE a.tenant_id = $1 AND a.action LIKE 'ledger.%'
            AND ((a.resource_type = 'journal_entry' AND e.id IS NULL) OR (a.resource_type = 'period_lock' AND l.id IS NULL))
          ORDER BY a.id`,
        [tenantId],
      )) as Array<{ id: string }>;
      const ledgerMissing = missing.map((r) => r.id);
      return { ok: ledgerMissing.length === 0, checked, brokenAtId: null, ledgerEvents, ledgerMissing };
    });
  }
}
