import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ops_error_events (T199): one row per error fingerprint per UTC day, so the table stays small.
 * Ops data, not customer data: `tenant_id` is nullable and informational only, there is NO tenant
 * RLS policy, and access is only through the platform-admin endpoint (@Roles ADMIN). Messages and
 * stacks are scrubbed and truncated before they get here (see ops-errors.util.ts).
 */
export class CreateOpsErrorEvents1789900011700 implements MigrationInterface {
  name = 'CreateOpsErrorEvents1789900011700';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ops_error_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
        "tenant_id" uuid,
        "sample_message" character varying(500),
        "sample_stack" text,
        "hour_start" timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
        "hour_count" integer NOT NULL DEFAULT 1,
        "prev_hour_count" integer NOT NULL DEFAULT 0,
        "alerted_at" timestamptz,
        "spike_alert_hour" timestamptz,
        CONSTRAINT "UQ_ops_error_events_fingerprint_day" UNIQUE ("fingerprint", "day")
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ops_error_events_last_seen" ON "ops_error_events" ("last_seen" DESC)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ops_error_events_unalerted" ON "ops_error_events" ("first_seen") WHERE "alerted_at" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ops_error_events"`);
  }
}
