import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Migration 1789900003700: per-tenant progress of the new-company setup wizard (T96).
 *
 * One row per organisation (the primary key IS the tenant id). `steps` maps a step key to
 * 'done' | 'skipped'; a missing key is pending. The company economic code and national id the
 * wizard collects live here too: no other table holds them (the Moadian credential keeps its own
 * copy of the economic code, encrypted next to the certificate).
 *
 * Organisations that exist when this migration runs are backfilled as already handled and
 * dismissed, so only organisations created afterwards are sent to the wizard. The backfill runs
 * BEFORE FORCE RLS is enabled: the table owner is subject to FORCE RLS, so it could not insert
 * rows for other tenants afterwards.
 */
export class CreateTenantOnboardingProgress1789900003700 implements MigrationInterface {
  name = 'CreateTenantOnboardingProgress1789900003700';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_onboarding_progress" (
        "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
        "steps" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "economic_code" varchar(14) NULL,
        "national_id" varchar(11) NULL,
        "dismissed" boolean NOT NULL DEFAULT false,
        "first_visit_handled_at" timestamptz NULL,
        "completed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_tenant_onboarding_economic_code" CHECK ("economic_code" IS NULL OR "economic_code" ~ '^[0-9]{11,14}$'),
        CONSTRAINT "CHK_tenant_onboarding_national_id" CHECK ("national_id" IS NULL OR "national_id" ~ '^[0-9]{10,11}$')
      )
    `);

    await q.query(`
      INSERT INTO "tenant_onboarding_progress" ("tenant_id", "dismissed", "first_visit_handled_at")
      SELECT "id", true, now() FROM "tenants"
      ON CONFLICT ("tenant_id") DO NOTHING
    `);

    await enableTenantRls(q, 'tenant_onboarding_progress');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'tenant_onboarding_progress');
    await q.query('DROP TABLE IF EXISTS "tenant_onboarding_progress"');
  }
}
