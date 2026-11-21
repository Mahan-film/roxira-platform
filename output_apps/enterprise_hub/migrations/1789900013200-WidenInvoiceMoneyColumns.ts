import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T169 (#901): Widen invoice amount columns from numeric(18,2) to numeric(20,4)
 * for 3-decimal currency support without losing integer capacity or altering
 * existing 2-decimal rows.
 */
export class WidenInvoiceMoneyColumns1789900013200 implements MigrationInterface {
  name = 'WidenInvoiceMoneyColumns1789900013200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ALTER COLUMN "totalAmount" TYPE numeric(20,4),
        ALTER COLUMN "totalDiscount" TYPE numeric(20,4),
        ALTER COLUMN "totalTax" TYPE numeric(20,4),
        ALTER COLUMN "finalPayable" TYPE numeric(20,4),
        ALTER COLUMN "baseTotalAmount" TYPE numeric(20,4),
        ALTER COLUMN "baseTotalTax" TYPE numeric(20,4),
        ALTER COLUMN "baseFinalPayable" TYPE numeric(20,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ALTER COLUMN "totalAmount" TYPE numeric(18,2),
        ALTER COLUMN "totalDiscount" TYPE numeric(18,2),
        ALTER COLUMN "totalTax" TYPE numeric(18,2),
        ALTER COLUMN "finalPayable" TYPE numeric(18,2),
        ALTER COLUMN "baseTotalAmount" TYPE numeric(18,2),
        ALTER COLUMN "baseTotalTax" TYPE numeric(18,2),
        ALTER COLUMN "baseFinalPayable" TYPE numeric(18,2)
    `);
  }
}
