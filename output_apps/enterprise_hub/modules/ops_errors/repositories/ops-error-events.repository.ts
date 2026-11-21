import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SPIKE_FACTOR, SPIKE_MIN_COUNT } from '../constants/ops-errors.constants';
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
  tenantId: string | null;
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

/**
 * Persistence for ops_error_events. Ops data with no tenant policy: the table is reachable only
 * through the platform-admin controller and the alert worker, never from tenant-scoped code.
 */
@Injectable()
export class OpsErrorEventsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** One row per fingerprint and UTC day; repeated errors only bump count and the hourly counters. */
  async upsert(e: OpsErrorEvent): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ops_error_events
         (fingerprint, day, source, error_class, route, http_method, status, release, tenant_id,
          sample_message, sample_stack)
       VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (fingerprint, day) DO UPDATE SET
         last_seen = now(),
         count = ops_error_events.count + 1,
         prev_hour_count = CASE
           WHEN ops_error_events.hour_start = date_trunc('hour', now()) THEN ops_error_events.prev_hour_count
           WHEN ops_error_events.hour_start = date_trunc('hour', now()) - interval '1 hour' THEN ops_error_events.hour_count
           ELSE 0 END,
         hour_count = CASE
           WHEN ops_error_events.hour_start = date_trunc('hour', now()) THEN ops_error_events.hour_count + 1
           ELSE 1 END,
         hour_start = date_trunc('hour', now()),
         route = COALESCE(EXCLUDED.route, ops_error_events.route),
         status = COALESCE(EXCLUDED.status, ops_error_events.status),
         release = COALESCE(EXCLUDED.release, ops_error_events.release)`,
      [
        e.fingerprint,
        e.source,
        e.errorClass,
        e.route,
        e.httpMethod,
        e.status,
        e.release,
        e.tenantId,
        e.sampleMessage,
        e.sampleStack,
      ],
    );
  }

  async list(
    limit: number,
    offset: number,
    source?: string,
  ): Promise<{ items: OpsErrorRow[]; total: number }> {
    const where = source ? 'WHERE source = $3' : '';
    const params: unknown[] = source ? [limit, offset, source] : [limit, offset];
    const items = (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM ops_error_events ${where} ORDER BY last_seen DESC LIMIT $1 OFFSET $2`,
      params,
    )) as OpsErrorRow[];
    const [{ n }] = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ops_error_events ${source ? 'WHERE source = $1' : ''}`,
      source ? [source] : [],
    )) as { n: number }[];
    return { items, total: n };
  }

  /** Fingerprints never seen on an earlier day and not alerted yet. */
  async findNewUnalerted(limit: number): Promise<OpsErrorRow[]> {
    return (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM ops_error_events e
        WHERE e.alerted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ops_error_events o WHERE o.fingerprint = e.fingerprint AND o.day < e.day)
        ORDER BY e.first_seen LIMIT $1`,
      [limit],
    )) as OpsErrorRow[];
  }

  /** This hour's count is at least 10x the previous hour's (and at least 10), not alerted this hour. */
  async findSpikes(limit: number): Promise<OpsErrorRow[]> {
    return (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM ops_error_events
        WHERE hour_start = date_trunc('hour', now())
          AND hour_count >= $2
          AND hour_count >= $3 * GREATEST(prev_hour_count, 1)
          AND spike_alert_hour IS DISTINCT FROM hour_start
        ORDER BY hour_count DESC LIMIT $1`,
      [limit, SPIKE_MIN_COUNT, SPIKE_FACTOR],
    )) as OpsErrorRow[];
  }

  async markAlerted(id: string): Promise<void> {
    await this.dataSource.query(`UPDATE ops_error_events SET alerted_at = now() WHERE id = $1`, [id]);
  }

  async markSpikeAlerted(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ops_error_events SET spike_alert_hour = hour_start, alerted_at = COALESCE(alerted_at, now()) WHERE id = $1`,
      [id],
    );
  }

  /** Top fingerprints of the last 24 hours by occurrences. */
  async topLast24h(limit: number): Promise<OpsErrorDigestRow[]> {
    return (await this.dataSource.query(
      `SELECT fingerprint,
              (array_agg(error_class ORDER BY last_seen DESC))[1] AS "errorClass",
              (array_agg(route ORDER BY last_seen DESC))[1] AS route,
              (array_agg(release ORDER BY last_seen DESC))[1] AS release,
              (array_agg(source ORDER BY last_seen DESC))[1] AS source,
              sum(count)::int AS total
         FROM ops_error_events
        WHERE last_seen >= now() - interval '24 hours'
        GROUP BY fingerprint ORDER BY total DESC LIMIT $1`,
      [limit],
    )) as OpsErrorDigestRow[];
  }

  async purgeOlderThan(days: number): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM ops_error_events WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::int`,
      [days],
    );
  }
}
