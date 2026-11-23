import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  PLATFORM_OPS_TENANT_ID,
  SPIKE_FACTOR,
  SPIKE_MIN_COUNT,
} from '../constants/ops-errors.constants';
import { OpsErrorEvent } from '../ops-errors.util';

export interface OpsErrorRow {
  id: string;
  fingerprint: string;
  day: string;
  source: string;
  errorClass: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  route: string | null;
  httpMethod: string | null;
  status: number | null;
  release: string | null;
  tenantId: string;
  sampleMessage: string | null;
  hourCount: number;
  prevHourCount: number;
}

export interface OpsErrorDigestRow {
  fingerprint: string;
  errorClass: string;
  route: string | null;
  release: string | null;
  source: string;
  total: number;
}

const COLUMNS = `
  id, fingerprint, to_char(day, 'YYYY-MM-DD') AS day, source, error_class AS "errorClass",
  first_seen AS "firstSeen", last_seen AS "lastSeen", count, route, http_method AS "httpMethod",
  status, release, tenant_id AS "tenantId", sample_message AS "sampleMessage",
  hour_count AS "hourCount", prev_hour_count AS "prevHourCount"`;

const ALIASED_COLUMNS = `
  e.id, e.fingerprint, to_char(e.day, 'YYYY-MM-DD') AS day, e.source, e.error_class AS "errorClass",
  e.first_seen AS "firstSeen", e.last_seen AS "lastSeen", e.count, e.route, e.http_method AS "httpMethod",
  e.status, e.release, e.tenant_id AS "tenantId", e.sample_message AS "sampleMessage",
  e.hour_count AS "hourCount", e.prev_hour_count AS "prevHourCount"`;

/**
 * Tenant-scoped persistence for ops_error_events.
 *
 * Every query touching `ops_error_events` executes inside `TenantScope.run(tenantId, ...)` so
 * PostgreSQL FORCE RLS (`app.tenant_id`) is enforced on every read and write. Unauthenticated /
 * platform-level errors use `PLATFORM_OPS_TENANT_ID`.
 */
@Injectable()
export class OpsErrorEventsRepository {
  constructor(
    private readonly scope: TenantScope,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Enumerates all tenant scopes (plus the platform scope) across the tenants registry table.
   * `tenants` is a global table without a tenant_id column; querying outside TenantScope avoids
   * zero-row returns under RLS for roxira_app.
   */
  async scanTenantIds(): Promise<string[]> {
    // tenant-scope-ok: tenants table has no tenant_id column and enumerates all tenant ids for ops alert scans
    const rows = await this.dataSource.query<{ id: string }[]>(`SELECT id FROM tenants`);
    const ids = new Set<string>([PLATFORM_OPS_TENANT_ID]);
    for (const r of rows) {
      if (r.id) ids.add(r.id);
    }
    return [...ids];
  }

  /** One row per (tenant, fingerprint, UTC day); repeated errors bump count and hourly counters. */
  async upsert(tenantId: string, e: OpsErrorEvent): Promise<void> {
    await this.scope.run(tenantId, async (m) => {
      await m.query(
        `INSERT INTO ops_error_events
           (tenant_id, fingerprint, day, source, error_class, route, http_method, status, release,
            sample_message, sample_stack)
         VALUES ($1, $2, timezone('utc', now())::date, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, fingerprint, day) DO UPDATE SET
           last_seen = now(),
           count = ops_error_events.count + 1,
           prev_hour_count = CASE
             WHEN ops_error_events.hour_start = date_trunc('hour', timezone('utc', now())) THEN ops_error_events.prev_hour_count
             WHEN ops_error_events.hour_start = date_trunc('hour', timezone('utc', now())) - interval '1 hour' THEN ops_error_events.hour_count
             ELSE 0 END,
           hour_count = CASE
             WHEN ops_error_events.hour_start = date_trunc('hour', timezone('utc', now())) THEN ops_error_events.hour_count + 1
             ELSE 1 END,
           hour_start = date_trunc('hour', timezone('utc', now())),
           route = COALESCE(EXCLUDED.route, ops_error_events.route),
           status = COALESCE(EXCLUDED.status, ops_error_events.status),
           release = COALESCE(EXCLUDED.release, ops_error_events.release)`,
        [
          tenantId,
          e.fingerprint,
          e.source,
          e.errorClass,
          e.route,
          e.httpMethod,
          e.status,
          e.release,
          e.sampleMessage,
          e.sampleStack,
        ],
      );
    });
  }

  async list(
    tenantId: string,
    limit: number,
    offset: number,
    source?: string,
  ): Promise<{ items: OpsErrorRow[]; total: number }> {
    return this.scope.run(tenantId, async (m) => {
      const items = (await m.query(
        `SELECT ${COLUMNS} FROM ops_error_events
          WHERE tenant_id = $1${source ? ' AND source = $4' : ''}
          ORDER BY last_seen DESC LIMIT $2 OFFSET $3`,
        source ? [tenantId, limit, offset, source] : [tenantId, limit, offset],
      )) as OpsErrorRow[];
      const [{ n }] = (await m.query(
        `SELECT count(*)::int AS n FROM ops_error_events
          WHERE tenant_id = $1${source ? ' AND source = $2' : ''}`,
        source ? [tenantId, source] : [tenantId],
      )) as { n: number }[];
      return { items, total: n };
    });
  }

  /** Fingerprints never seen on an earlier day for this tenant and not alerted yet. */
  async findNewUnalerted(tenantId: string, limit: number): Promise<OpsErrorRow[]> {
    return this.scope.run(tenantId, async (m) => {
      return (await m.query(
        `SELECT ${ALIASED_COLUMNS} FROM ops_error_events e
          WHERE e.tenant_id = $1
            AND e.alerted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM ops_error_events o
               WHERE o.tenant_id = e.tenant_id AND o.fingerprint = e.fingerprint AND o.day < e.day
            )
          ORDER BY e.first_seen LIMIT $2`,
        [tenantId, limit],
      )) as OpsErrorRow[];
    });
  }

  /** This hour's count is at least 10x the previous hour's (and at least 10), not alerted this hour. */
  async findSpikes(tenantId: string, limit: number): Promise<OpsErrorRow[]> {
    return this.scope.run(tenantId, async (m) => {
      return (await m.query(
        `SELECT ${COLUMNS} FROM ops_error_events
          WHERE tenant_id = $1
            AND hour_start = date_trunc('hour', now())
            AND hour_count >= $3
            AND hour_count >= $4 * GREATEST(prev_hour_count, 1)
            AND spike_alert_hour IS DISTINCT FROM hour_start
          ORDER BY hour_count DESC LIMIT $2`,
        [tenantId, limit, SPIKE_MIN_COUNT, SPIKE_FACTOR],
      )) as OpsErrorRow[];
    });
  }

  async markAlerted(tenantId: string, id: string): Promise<void> {
    await this.scope.run(tenantId, async (m) => {
      await m.query(
        `UPDATE ops_error_events SET alerted_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
    });
  }

  async markSpikeAlerted(tenantId: string, id: string): Promise<void> {
    await this.scope.run(tenantId, async (m) => {
      await m.query(
        `UPDATE ops_error_events
            SET spike_alert_hour = hour_start, alerted_at = COALESCE(alerted_at, now())
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
    });
  }

  /** Top fingerprints of the last 24 hours for this tenant by occurrences. */
  async topLast24h(tenantId: string, limit: number): Promise<OpsErrorDigestRow[]> {
    return this.scope.run(tenantId, async (m) => {
      return (await m.query(
        `SELECT fingerprint,
                (array_agg(error_class ORDER BY last_seen DESC))[1] AS "errorClass",
                (array_agg(route ORDER BY last_seen DESC))[1] AS route,
                (array_agg(release ORDER BY last_seen DESC))[1] AS release,
                (array_agg(source ORDER BY last_seen DESC))[1] AS source,
                sum(count)::int AS total
           FROM ops_error_events
          WHERE tenant_id = $1 AND last_seen >= now() - interval '24 hours'
          GROUP BY fingerprint ORDER BY total DESC LIMIT $2`,
        [tenantId, limit],
      )) as OpsErrorDigestRow[];
    });
  }

  async purgeOlderThan(tenantId: string, days: number): Promise<void> {
    await this.scope.run(tenantId, async (m) => {
      await m.query(
        `DELETE FROM ops_error_events
          WHERE tenant_id = $1 AND day < (now() AT TIME ZONE 'UTC')::date - $2::int`,
        [tenantId, days],
      );
    });
  }
}
