import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Plan entitlements and monthly usage metering (T145 / R5 Decision 2).
 *
 * - tenant_plans: per-tenant plan assignment, optional JSONB limit overrides, and rollover_day.
 * - usage_counters: per-tenant, per-meter, per-period usage counter with atomic updates.
 * Both tables have tenant_id, FORCE RLS, and grants to roxira_app.
 */
export class CreatePlanEntitlementsAndUsageCounters1789900010600 implements MigrationInterface {
  name = 'CreatePlanEntitlementsAndUsageCounters1789900010600';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "plan_key" varchar(64) NOT NULL DEFAULT 'starter',
        "limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "rollover_day" smallint NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tenant_plans_tenant_id" UNIQUE ("tenant_id"),
        CONSTRAINT "CHK_tenant_plans_rollover_day" CHECK ("rollover_day" BETWEEN 1 AND 28)
      )
    `);

    await enableTenantRls(q, 'tenant_plans');

    await q.query(`
      CREATE TABLE IF NOT EXISTS "usage_counters" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "meter" varchar(64) NOT NULL,
        "period_key" varchar(16) NOT NULL,
        "used" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_counters" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_usage_counters_tenant_meter_period" UNIQUE ("tenant_id", "meter", "period_key"),
        CONSTRAINT "CHK_usage_counters_used_nonneg" CHECK ("used" >= 0)
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_usage_counters_tenant_period"
        ON "usage_counters" ("tenant_id", "period_key")
    `);

    await enableTenantRls(q, 'usage_counters');

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_plans", "usage_counters" TO roxira_app;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'usage_counters');
    await q.query(`DROP TABLE IF EXISTS "usage_counters"`);
    await disableTenantRls(q, 'tenant_plans');
    await q.query(`DROP TABLE IF EXISTS "tenant_plans"`);
  }
}
