import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T224: Legal entities table carrying per-entity VAT/tax/e-invoicing registration IDs
 * (separate from tenant settings and separate from any UAE VAT group TIN), with backfill
 * from existing `tenants` and `tenant_onboarding_progress` rows.
 */
export class CreateLegalEntitiesAndTaxIds1789900012100 implements MigrationInterface {
  name = 'CreateLegalEntitiesAndTaxIds1789900012100';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "legal_entities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" character varying(200) NOT NULL,
        "country_code" character varying(2) NOT NULL DEFAULT 'IR',
        "vat_id" character varying(32),
        "tax_id" character varying(32),
        "einvoice_id" character varying(64),
        "vat_group_tin" character varying(32),
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_legal_entities_tenant_code" ON "legal_entities" ("tenant_id", "code")`,
    );
    await enableTenantRls(q, 'legal_entities');

    await q.query(
      `INSERT INTO "legal_entities" ("tenant_id", "code", "name", "country_code", "tax_id", "is_default")
       SELECT t."id",
              'DEFAULT',
              t."name",
              COALESCE(t."country_code", 'IR'),
              COALESCE(op."economic_code", op."national_id"),
              true
         FROM "tenants" t
         LEFT JOIN "tenant_onboarding_progress" op ON op."tenant_id" = t."id"
       ON CONFLICT ("tenant_id", "code") DO NOTHING`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'legal_entities');
    await q.query(`DROP TABLE IF EXISTS "legal_entities"`);
  }
}
