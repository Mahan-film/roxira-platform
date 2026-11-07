import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFixedAssetDisposal1789900000300 implements MigrationInterface {
  name = 'AddFixedAssetDisposal1789900000300';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "fin_fixed_assets"
        ADD COLUMN "disposal_date" date,
        ADD COLUMN "disposal_proceeds" numeric(18,2),
        ADD COLUMN "disposal_journal_entry_id" integer,
        ADD CONSTRAINT "FK_fin_fixed_assets_disposal_entry"
          FOREIGN KEY ("disposal_journal_entry_id") REFERENCES "fin_journal_entries" ("id") ON DELETE SET NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "fin_fixed_assets"
        DROP CONSTRAINT IF EXISTS "FK_fin_fixed_assets_disposal_entry",
        DROP COLUMN IF EXISTS "disposal_journal_entry_id",
        DROP COLUMN IF EXISTS "disposal_proceeds",
        DROP COLUMN IF EXISTS "disposal_date"
    `);
  }
}
