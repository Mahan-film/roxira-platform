import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anonymous (walk-in) and POS sales.
 *
 * - `tenants.country_code`: drives per-country invoice rules (default IR, the only market so far).
 * - `crm_leads`: `email` becomes optional (a customer known only by phone has none), plus
 *   `phone_normalized` (exact-match key; digits only, Persian/Arabic digits folded), `is_walk_in`
 *   (the one built-in anonymous customer per tenant, enforced by a partial unique index),
 *   `marketing_consent` (false: a sale never implies consent) and `source`.
 * - `invoices`: `idempotency_key` + `request_hash` (a retried POS sale returns the same invoice,
 *   never posts twice; unique per tenant) and `payments` (how the sale was paid).
 * All additive.
 */
export class AddWalkInCustomerAndPosSales1789450000000 implements MigrationInterface {
  name = 'AddWalkInCustomerAndPosSales1789450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "country_code" character varying(2) NOT NULL DEFAULT 'IR'`,
    );
    await queryRunner.query(`ALTER TABLE "crm_leads" ALTER COLUMN "email" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "crm_leads"
         ADD COLUMN IF NOT EXISTS "phone_normalized" character varying(24),
         ADD COLUMN IF NOT EXISTS "is_walk_in" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "marketing_consent" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "source" character varying(24)`,
    );
    // Same folding as the application (digits only, Persian/Arabic digits to Latin, +98 / 0098 / 98 to 0).
    await queryRunner.query(
      `UPDATE "crm_leads" SET "phone_normalized" = CASE
           WHEN d ~ '^0098[0-9]{10}$' THEN '0' || substr(d, 5)
           WHEN d ~ '^98[0-9]{10}$' THEN '0' || substr(d, 3)
           ELSE d END
         FROM (
           SELECT id AS lid,
             regexp_replace(translate(phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') AS d
           FROM "crm_leads" WHERE phone IS NOT NULL
         ) t
         WHERE "crm_leads".id = t.lid AND t.d <> ''`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_leads_tenant_phone" ON "crm_leads" ("tenant_id", "phone_normalized") WHERE "phone_normalized" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crm_leads_tenant_walk_in" ON "crm_leads" ("tenant_id") WHERE "is_walk_in"`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoices"
         ADD COLUMN IF NOT EXISTS "idempotency_key" character varying(80),
         ADD COLUMN IF NOT EXISTS "request_hash" character varying(64),
         ADD COLUMN IF NOT EXISTS "payments" jsonb`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoices_tenant_idempotency" ON "invoices" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_invoices_tenant_idempotency"`);
    await queryRunner.query(
      `ALTER TABLE "invoices"
         DROP COLUMN IF EXISTS "payments",
         DROP COLUMN IF EXISTS "request_hash",
         DROP COLUMN IF EXISTS "idempotency_key"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_crm_leads_tenant_walk_in"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_crm_leads_tenant_phone"`);
    await queryRunner.query(
      `ALTER TABLE "crm_leads"
         DROP COLUMN IF EXISTS "source",
         DROP COLUMN IF EXISTS "marketing_consent",
         DROP COLUMN IF EXISTS "is_walk_in",
         DROP COLUMN IF EXISTS "phone_normalized"`,
    );
    // Leads created without an email would block restoring NOT NULL; give them a unique placeholder.
    await queryRunner.query(
      `UPDATE "crm_leads" SET "email" = 'no-email-' || id || '@placeholder.invalid' WHERE "email" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "crm_leads" ALTER COLUMN "email" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "country_code"`);
  }
}
