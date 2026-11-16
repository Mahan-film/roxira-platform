import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Company Localisation & Lock Trigger Migration (WAVE 15 - T137).
 *
 * Implements R4 Decisions 1 & 2 (ADR_GLOBAL_CORE.md / R4_COUNTRY_PACKS.md):
 *   1. Company-scoped localisation columns on `tenants`:
 *      - `country_code`: ISO 3166-1 alpha-2 (default 'IR')
 *      - `pack_version`: semantic version of country pack (default '1.0.0')
 *      - `book_currency_code`: ISO 4217 book currency (default 'IRR')
 *      - `default_calendar`: presentation calendar (default 'jalali')
 *      - `timezone`: IANA time zone (default 'Asia/Tehran')
 *      - `locale`: primary BCP 47 locale tag (default 'fa-IR')
 *      - `fiscal_year_start_month`: 1..12 fiscal year start month (default 1)
 *
 *   2. Backfill existing tenants to the current 'IR' pack defaults.
 *
 *   3. Immutability trigger `trg_tenants_guard_localisation_lock` on `tenants`:
 *      Locks `country_code` and `book_currency_code` once any POSTED journal
 *      entry exists in `fin_journal_entries` for that tenant (Rule RX003).
 *
 *   4. Reversible `down()` drops triggers, functions, and columns cleanly.
 */
export class AddTenantLocalisationAndLockTrigger1789900010000
  implements MigrationInterface
{
  name = 'AddTenantLocalisationAndLockTrigger1789900010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add localisation columns to tenants
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "country_code" character varying(2) NOT NULL DEFAULT 'IR',
        ADD COLUMN IF NOT EXISTS "pack_version" character varying(20) NOT NULL DEFAULT '1.0.0',
        ADD COLUMN IF NOT EXISTS "book_currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        ADD COLUMN IF NOT EXISTS "default_calendar" character varying(20) NOT NULL DEFAULT 'jalali',
        ADD COLUMN IF NOT EXISTS "timezone" character varying(50) NOT NULL DEFAULT 'Asia/Tehran',
        ADD COLUMN IF NOT EXISTS "locale" character varying(20) NOT NULL DEFAULT 'fa-IR',
        ADD COLUMN IF NOT EXISTS "fiscal_year_start_month" smallint NOT NULL DEFAULT 1
    `);

    // 2. Backfill any existing tenants with NULL or missing localisation values
    await queryRunner.query(`
      UPDATE "tenants"
      SET
        "country_code" = COALESCE("country_code", 'IR'),
        "pack_version" = COALESCE("pack_version", '1.0.0'),
        "book_currency_code" = COALESCE("book_currency_code", 'IRR'),
        "default_calendar" = COALESCE("default_calendar", 'jalali'),
        "timezone" = COALESCE("timezone", 'Asia/Tehran'),
        "locale" = COALESCE("locale", 'fa-IR'),
        "fiscal_year_start_month" = COALESCE("fiscal_year_start_month", 1)
      WHERE
        "country_code" IS NULL
        OR "pack_version" IS NULL
        OR "book_currency_code" IS NULL
        OR "default_calendar" IS NULL
        OR "timezone" IS NULL
        OR "locale" IS NULL
        OR "fiscal_year_start_month" IS NULL
    `);

    // 3. Database lock trigger function: prevents modifying country_code or book_currency_code
    // once a POSTED journal entry exists for this tenant.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION tenant_guard_localisation_lock() RETURNS trigger AS $$
      BEGIN
        IF (UPPER(NEW.country_code) IS DISTINCT FROM UPPER(OLD.country_code)) OR (UPPER(NEW.book_currency_code) IS DISTINCT FROM UPPER(OLD.book_currency_code)) THEN
          IF EXISTS (
            SELECT 1 FROM "fin_journal_entries"
            WHERE "tenant_id" = OLD.id AND "status" = 'POSTED'
          ) THEN
            RAISE EXCEPTION 'cannot change country_code or book_currency_code once posted journal entries exist for tenant %', OLD.id
              USING ERRCODE = 'RX003';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_tenants_guard_localisation_lock" ON "tenants"
    `);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_tenants_guard_localisation_lock"
        BEFORE UPDATE ON "tenants"
        FOR EACH ROW EXECUTE FUNCTION tenant_guard_localisation_lock()
    `);

    // 4. Grant execute to application role if it exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          GRANT EXECUTE ON FUNCTION tenant_guard_localisation_lock() TO roxira_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_tenants_guard_localisation_lock" ON "tenants"
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS tenant_guard_localisation_lock()
    `);

    await queryRunner.query(`
      ALTER TABLE "tenants"
        DROP COLUMN IF EXISTS "fiscal_year_start_month",
        DROP COLUMN IF EXISTS "locale",
        DROP COLUMN IF EXISTS "timezone",
        DROP COLUMN IF EXISTS "default_calendar",
        DROP COLUMN IF EXISTS "book_currency_code",
        DROP COLUMN IF EXISTS "pack_version",
        DROP COLUMN IF EXISTS "country_code"
    `);
  }
}
