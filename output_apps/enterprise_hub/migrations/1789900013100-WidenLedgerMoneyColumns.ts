import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T169 (#901): Widen ledger amount columns from numeric(18,2) to numeric(20,4)
 * so 3-decimal currencies (OMR, KWD, BHD, JOD, IQD, LYD, TND) post without
 * truncation while keeping 16 integer digits and leaving existing 2-decimal
 * data unchanged.
 */
export class WidenLedgerMoneyColumns1789900013100 implements MigrationInterface {
  name = 'WidenLedgerMoneyColumns1789900013100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entry_lines"
        ALTER COLUMN "debit" TYPE numeric(20,4),
        ALTER COLUMN "credit" TYPE numeric(20,4),
        ALTER COLUMN "tx_debit" TYPE numeric(20,4),
        ALTER COLUMN "tx_credit" TYPE numeric(20,4),
        ALTER COLUMN "book_debit" TYPE numeric(20,4),
        ALTER COLUMN "book_credit" TYPE numeric(20,4)
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_chart_of_accounts"
        ALTER COLUMN "balance" TYPE numeric(20,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_chart_of_accounts"
        ALTER COLUMN "balance" TYPE numeric(18,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entry_lines"
        ALTER COLUMN "debit" TYPE numeric(18,2),
        ALTER COLUMN "credit" TYPE numeric(18,2),
        ALTER COLUMN "tx_debit" TYPE numeric(18,2),
        ALTER COLUMN "tx_credit" TYPE numeric(18,2),
        ALTER COLUMN "book_debit" TYPE numeric(18,2),
        ALTER COLUMN "book_credit" TYPE numeric(18,2)
    `);
  }
}
