import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T169 (#901): Widen treasury/payment amount columns from numeric(18,2) to
 * numeric(20,4) for 3-decimal currency support.
 */
export class WidenTreasuryMoneyColumns1789900013300 implements MigrationInterface {
  name = 'WidenTreasuryMoneyColumns1789900013300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_treasury_documents"
        ALTER COLUMN "total" TYPE numeric(20,4),
        ALTER COLUMN "writeoff_total" TYPE numeric(20,4),
        ALTER COLUMN "advance_remaining" TYPE numeric(20,4)
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_treasury_document_lines"
        ALTER COLUMN "amount" TYPE numeric(20,4)
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_treasury_allocations"
        ALTER COLUMN "amount" TYPE numeric(20,4),
        ALTER COLUMN "writeoff" TYPE numeric(20,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_treasury_allocations"
        ALTER COLUMN "amount" TYPE numeric(18,2),
        ALTER COLUMN "writeoff" TYPE numeric(18,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_treasury_document_lines"
        ALTER COLUMN "amount" TYPE numeric(18,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_treasury_documents"
        ALTER COLUMN "total" TYPE numeric(18,2),
        ALTER COLUMN "writeoff_total" TYPE numeric(18,2),
        ALTER COLUMN "advance_remaining" TYPE numeric(18,2)
    `);
  }
}
