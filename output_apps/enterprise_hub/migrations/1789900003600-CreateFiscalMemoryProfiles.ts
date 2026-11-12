import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T94 tax transmission core.
 *
 * - `fiscal_memory_profiles`: one row per fiscal memory id of a tenant (mode, environment, TSP).
 *   Holds no secret. FORCE RLS on tenant_id.
 * - `moadian_submissions` (already FORCE RLS): outbox/chain columns. The unique key becomes
 *   (tenant, invoice, ins) so the idempotency key is the one the design names. Old rows keep
 *   ins = 1 and NULL chain columns; the code falls back to tax_id for them.
 */
export class CreateFiscalMemoryProfiles1789900002900 implements MigrationInterface {
  name = 'CreateFiscalMemoryProfiles1789900002900';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_memory_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "memory_id" character varying(6) NOT NULL,
        "mode" character varying(24) NOT NULL,
        "environment" character varying(16) NOT NULL,
        "tsp_provider" character varying(64),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fiscal_memory_profiles_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fiscal_memory_profiles_memory_id" CHECK ("memory_id" ~ '^[A-Z0-9]{6}$'),
        CONSTRAINT "CHK_fiscal_memory_profiles_mode" CHECK ("mode" IN ('direct','tsp_taxpayer_key','tsp_tsp_key')),
        CONSTRAINT "CHK_fiscal_memory_profiles_env" CHECK ("environment" IN ('sandbox','production')),
        CONSTRAINT "CHK_fiscal_memory_profiles_tsp" CHECK (
          ("mode" = 'direct' AND "tsp_provider" IS NULL) OR ("mode" <> 'direct' AND "tsp_provider" IS NOT NULL)
        )
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_fiscal_memory_profiles_tenant_memory_env" ON "fiscal_memory_profiles" ("tenant_id", "memory_id", "environment")`,
    );
    await enableTenantRls(q, 'fiscal_memory_profiles');

    await q.query(`
      ALTER TABLE "moadian_submissions"
        ADD COLUMN IF NOT EXISTS "ins" smallint NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "root_invoice_id" uuid,
        ADD COLUMN IF NOT EXISTS "reference_tax_id" character varying(22),
        ADD COLUMN IF NOT EXISTS "active_reference_tax_id" character varying(22),
        ADD COLUMN IF NOT EXISTS "profile_id" uuid,
        ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0
    `);
    await q.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_submissions_tenant_invoice"`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_moadian_submissions_tenant_invoice_ins" ON "moadian_submissions" ("tenant_id", "invoice_id", "ins")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_moadian_submissions_tenant_root" ON "moadian_submissions" ("tenant_id", "root_invoice_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_submissions_tenant_root"`);
    await q.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_submissions_tenant_invoice_ins"`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_moadian_submissions_tenant_invoice" ON "moadian_submissions" ("tenant_id", "invoice_id")`,
    );
    await q.query(`
      ALTER TABLE "moadian_submissions"
        DROP COLUMN IF EXISTS "attempt_count",
        DROP COLUMN IF EXISTS "profile_id",
        DROP COLUMN IF EXISTS "active_reference_tax_id",
        DROP COLUMN IF EXISTS "reference_tax_id",
        DROP COLUMN IF EXISTS "root_invoice_id",
        DROP COLUMN IF EXISTS "ins"
    `);
    await disableTenantRls(q, 'fiscal_memory_profiles');
    await q.query(`DROP TABLE IF EXISTS "fiscal_memory_profiles"`);
  }
}
