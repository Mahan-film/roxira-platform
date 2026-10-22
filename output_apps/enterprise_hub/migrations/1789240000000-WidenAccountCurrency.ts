import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen `fin_chart_of_accounts.currency` from 3 to 8 characters so imported multi-currency accounts can
 * keep `MULTI` (the owner's ERP challenge database has two). Additive; no transaction override.
 */
export class WidenAccountCurrency1789240000000 implements MigrationInterface {
  name = 'WidenAccountCurrency1789240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fin_chart_of_accounts" ALTER COLUMN "currency" TYPE character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fin_chart_of_accounts" ALTER COLUMN "currency" TYPE character varying(3) USING left("currency", 3)`,
    );
  }
}
