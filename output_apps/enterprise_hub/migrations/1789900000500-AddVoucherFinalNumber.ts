import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Additive «شمارهٔ قطعی» (final number) per tenant and fiscal year.
 *
 *  - `fin_journal_entries.permanent_number` (bigint, NULL until the voucher is POSTED) and
 *    `permanent_fiscal_year_id` (int, 0 when no fiscal year row covers the voucher date).
 *  - `fin_voucher_counters`: one row per (tenant, fiscal year) holding the last handed out number.
 *  - A unique index on (tenant, fiscal year id, permanent number) where the number is set.
 *  - `fin_assign_permanent_number()` on BEFORE INSERT OR UPDATE: the first time an entry becomes
 *    POSTED (inserted as POSTED, or DRAFT/TEMPORARY -> POSTED through any path) it takes the next
 *    number of its fiscal year. The counter row is locked and incremented in the same transaction,
 *    so a rollback leaves no gap; the number is never reassigned afterwards. A second wall refuses
 *    any attempt to change a number that is already set (the posted-entry trigger already makes a
 *    POSTED row immutable).
 *
 * The working number `entry_number` is unchanged; existing rows keep NULL permanent numbers (no
 * backfill). Purely additive.
 *
 * Revert: `down()` drops the trigger, function, index, columns and counter table.
 */
export class AddVoucherFinalNumber1789900000500 implements MigrationInterface {
  name = 'AddVoucherFinalNumber1789900000500';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "permanent_number" bigint`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "permanent_fiscal_year_id" integer`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_voucher_counters" (
        "tenant_id" uuid NOT NULL,
        "fiscal_year_id" integer NOT NULL,
        "last_number" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_fin_voucher_counters" PRIMARY KEY ("tenant_id", "fiscal_year_id")
      )
    `);
    await enableTenantRls(q, 'fin_voucher_counters');

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_journal_entries_tenant_fy_permanent_number"
        ON "fin_journal_entries" ("tenant_id", "permanent_fiscal_year_id", "permanent_number")
        WHERE "permanent_number" IS NOT NULL
    `);

    await q.query(`
      CREATE OR REPLACE FUNCTION fin_assign_permanent_number() RETURNS trigger AS $$
      DECLARE
        fy integer;
        next_number bigint;
        becomes_posted boolean := false;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          IF OLD.permanent_number IS NOT NULL
             AND NEW.permanent_number IS DISTINCT FROM OLD.permanent_number THEN
            RAISE EXCEPTION 'permanent voucher number of entry % is immutable', OLD.id
              USING ERRCODE = 'RX006';
          END IF;
          IF OLD.status IS DISTINCT FROM 'POSTED' THEN
            becomes_posted := true;
          END IF;
        ELSE
          becomes_posted := true;
        END IF;

        -- An INSERT whose working number is already taken is skipped by the writer (ON CONFLICT DO
        -- NOTHING); it must not consume a final number.
        IF TG_OP = 'INSERT' AND EXISTS (
          SELECT 1 FROM fin_journal_entries
           WHERE tenant_id = NEW.tenant_id AND entry_number = NEW.entry_number
        ) THEN
          RETURN NEW;
        END IF;

        IF NEW.status = 'POSTED' AND NEW.permanent_number IS NULL AND becomes_posted THEN
          SELECT COALESCE((
            SELECT id FROM fin_fiscal_years
             WHERE tenant_id = NEW.tenant_id
               AND NEW.date::date BETWEEN start_date AND end_date
             ORDER BY start_date
             LIMIT 1
          ), 0) INTO fy;

          INSERT INTO fin_voucher_counters (tenant_id, fiscal_year_id, last_number)
            VALUES (NEW.tenant_id, fy, 1)
            ON CONFLICT (tenant_id, fiscal_year_id)
            DO UPDATE SET last_number = fin_voucher_counters.last_number + 1
            RETURNING last_number INTO next_number;

          NEW.permanent_number := next_number;
          NEW.permanent_fiscal_year_id := fy;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`
      CREATE TRIGGER "TRG_fin_journal_entries_assign_permanent_number"
        BEFORE INSERT OR UPDATE ON "fin_journal_entries"
        FOR EACH ROW EXECUTE FUNCTION fin_assign_permanent_number()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_journal_entries_assign_permanent_number" ON "fin_journal_entries"`,
    );
    await q.query(`DROP FUNCTION IF EXISTS fin_assign_permanent_number()`);
    await q.query(
      `DROP INDEX IF EXISTS "UQ_fin_journal_entries_tenant_fy_permanent_number"`,
    );
    await disableTenantRls(q, 'fin_voucher_counters');
    await q.query(`DROP TABLE IF EXISTS "fin_voucher_counters"`);
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "permanent_fiscal_year_id"`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "permanent_number"`,
    );
  }
}
