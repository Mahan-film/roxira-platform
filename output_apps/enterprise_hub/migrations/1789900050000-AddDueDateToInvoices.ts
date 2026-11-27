import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDueDateToInvoices1789900050000 implements MigrationInterface {
  name = 'AddDueDateToInvoices1789900050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" date NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_invoices_tenant_due_date" ON "invoices" ("tenant_id", "due_date") WHERE "due_date" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_invoices_tenant_due_date"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "due_date"`,
    );
  }
}
