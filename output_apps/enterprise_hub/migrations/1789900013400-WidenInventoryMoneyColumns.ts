import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T169 (#901): Widen stock-value amount columns from numeric(18,2) to
 * numeric(20,4) for 3-decimal currency support.
 */
export class WidenInventoryMoneyColumns1789900013400 implements MigrationInterface {
  name = 'WidenInventoryMoneyColumns1789900013400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "erp_stock_document_lines"
        ALTER COLUMN "unit_cost" TYPE numeric(20,4),
        ALTER COLUMN "value" TYPE numeric(20,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "erp_stock_document_lines"
        ALTER COLUMN "unit_cost" TYPE numeric(18,2),
        ALTER COLUMN "value" TYPE numeric(18,2)
    `);
  }
}
