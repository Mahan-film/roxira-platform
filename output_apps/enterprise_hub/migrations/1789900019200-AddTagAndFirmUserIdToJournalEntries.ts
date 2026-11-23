import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T196 (R16 Test 12):
 * 1. Add `tag` and `firm_user_id` to `fin_journal_entries` for server-side partner-advisor
 *    adjustment journal tagging (`PARTNER_ADJUSTMENT`) and user attribution.
 * 2. Ensure `fin_fiscal_years.adjustment_period_open` exists (`IF NOT EXISTS`) so partner-advisor
 *    journal postings are restricted to server-side open adjustment periods.
 *
 * Locking note:
 * - No `transaction = false` / `CREATE INDEX CONCURRENTLY`: the deploy runner uses TypeORM
 *   transaction mode "all", which rejects per-migration transaction overrides
 *   (`ForbiddenTransactionModeOverrideError`, see 1789210000000-AddInvoicingVatCustomerPaid.ts).
 * - `tag` is a brand-new nullable column (NULL on all existing rows), so the partial index
 *   `WHERE "tag" IS NOT NULL` builds an empty 0-entry index in ~1 ms, guarded by
 *   `SET LOCAL lock_timeout = '3s'`.
 */
export class AddTagAndFirmUserIdToJournalEntries1789900019200
  implements MigrationInterface
{
  name = 'AddTagAndFirmUserIdToJournalEntries1789900019200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entries"
        ADD COLUMN IF NOT EXISTS "tag" character varying(64),
        ADD COLUMN IF NOT EXISTS "firm_user_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_fiscal_years"
        ADD COLUMN IF NOT EXISTS "adjustment_period_open" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entries_tenant_tag"
        ON "fin_journal_entries" ("tenant_id", "tag")
        WHERE "tag" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_fin_journal_entries_tenant_tag"
    `);
    // Rollback only intended for pre-production/fresh-DB revert tests; production requires a backup snapshot.
    await queryRunner.query(`
      ALTER TABLE "fin_fiscal_years"
        DROP COLUMN IF EXISTS "adjustment_period_open"
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entries"
        DROP COLUMN IF EXISTS "firm_user_id",
        DROP COLUMN IF EXISTS "tag"
    `);
  }
}
