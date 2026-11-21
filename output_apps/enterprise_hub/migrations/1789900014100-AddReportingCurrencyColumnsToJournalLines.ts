import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T179: Add reporting currency columns to fin_journal_entry_lines so every
 * journal line carries transaction (tx_*), book (book_*), and reporting
 * (reporting_*) amounts with 6-decimal FX rate precision.
 */
export class AddReportingCurrencyColumnsToJournalLines1789900014100
  implements MigrationInterface
{
  name = 'AddReportingCurrencyColumnsToJournalLines1789900014100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entry_lines"
        ADD COLUMN IF NOT EXISTS "reporting_currency_code" varchar(8) NULL,
        ADD COLUMN IF NOT EXISTS "reporting_fx_rate" numeric(24,6) NULL,
        ADD COLUMN IF NOT EXISTS "reporting_debit" numeric(20,4) NULL,
        ADD COLUMN IF NOT EXISTS "reporting_credit" numeric(20,4) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entry_lines"
        DROP COLUMN IF EXISTS "reporting_credit",
        DROP COLUMN IF EXISTS "reporting_debit",
        DROP COLUMN IF EXISTS "reporting_fx_rate",
        DROP COLUMN IF EXISTS "reporting_currency_code"
    `);
  }
}
