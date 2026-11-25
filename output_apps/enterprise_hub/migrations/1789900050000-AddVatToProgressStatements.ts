import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * افزودن ستون مبلغ مالیات بر ارزش افزوده (`vat_amount`) به جدول صورت وضعیت‌ها (`erp_progress_statements`).
 */
export class AddVatToProgressStatements1789900050000 implements MigrationInterface {
  name = 'AddVatToProgressStatements1789900050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "erp_progress_statements"
      ADD COLUMN IF NOT EXISTS "vat_amount" numeric(18,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "erp_progress_statements"
      DROP COLUMN IF EXISTS "vat_amount"
    `);
  }
}
