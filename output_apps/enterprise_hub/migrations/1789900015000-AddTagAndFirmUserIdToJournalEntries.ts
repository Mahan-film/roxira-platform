import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T196 (R16 Test 12): Add `tag` and `firm_user_id` to `fin_journal_entries`
 * for partner-advisor adjustment journal tagging and attribution.
 */
export class AddTagAndFirmUserIdToJournalEntries1789900015000
  implements MigrationInterface
{
  name = 'AddTagAndFirmUserIdToJournalEntries1789900015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entries"
        ADD COLUMN IF NOT EXISTS "tag" character varying(64),
        ADD COLUMN IF NOT EXISTS "firm_user_id" uuid
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
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entries"
        DROP COLUMN IF EXISTS "firm_user_id",
        DROP COLUMN IF EXISTS "tag"
    `);
  }
}
