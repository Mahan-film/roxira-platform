import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * ops_error_events (T199 / #1093): one row per (tenant_id, fingerprint, UTC day).
 *
 * Protected by ENABLE + FORCE ROW LEVEL SECURITY via `enableTenantRls`, keyed on `tenant_id`.
 * Unauthenticated, system, and AI-core errors without a tenant context use the nil-UUID
 * platform scope (`00000000-0000-0000-0000-000000000000`). Messages and stacks are scrubbed
 * and truncated before persistence (see ops-errors.util.ts).
 */
export class CreateOpsErrorEvents1789900019400 implements MigrationInterface {
  name = 'CreateOpsErrorEvents1789900019400';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ops_error_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        "fingerprint" character varying(64) NOT NULL,
        "day" date NOT NULL,
        "source" character varying(16) NOT NULL DEFAULT 'backend',
        "error_class" character varying(120) NOT NULL,
        "first_seen" timestamptz NOT NULL DEFAULT now(),
        "last_seen" timestamptz NOT NULL DEFAULT now(),
        "count" integer NOT NULL DEFAULT 1,
        "route" character varying(200),
        "http_method" character varying(10),
        "status" integer,
        "release" character varying(64),
        "sample_message" character varying(500),
        "sample_stack" text,
        "hour_start" timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
        "hour_count" integer NOT NULL DEFAULT 1,
        "prev_hour_count" integer NOT NULL DEFAULT 0,
        "alerted_at" timestamptz,
        "spike_alert_hour" timestamptz,
        CONSTRAINT "UQ_ops_error_events_tenant_fingerprint_day" UNIQUE ("tenant_id", "fingerprint", "day")
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ops_error_events_tenant_last_seen" ON "ops_error_events" ("tenant_id", "last_seen" DESC)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ops_error_events_tenant_unalerted" ON "ops_error_events" ("tenant_id", "first_seen") WHERE "alerted_at" IS NULL`,
    );
    await enableTenantRls(q, 'ops_error_events');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'ops_error_events');
    await q.query(`DROP TABLE IF EXISTS "ops_error_events"`);
  }
}
