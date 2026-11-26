import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #440: Optional salesperson_id on invoices [hotspot].
 * Links an invoice to a user/member within the tenant.
 */
export class AddInvoiceSalespersonId1789900052000 implements MigrationInterface {
  name = 'AddInvoiceSalespersonId1789900052000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "salesperson_id" uuid NULL
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_invoices_salesperson'
        ) THEN
          ALTER TABLE "invoices"
            ADD CONSTRAINT "FK_invoices_salesperson"
            FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL NOT VALID;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "invoices" VALIDATE CONSTRAINT "FK_invoices_salesperson"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_salesperson"
        ON "invoices" ("tenant_id", "salesperson_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invoices_tenant_salesperson"`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP CONSTRAINT IF EXISTS "FK_invoices_salesperson",
        DROP COLUMN IF EXISTS "salesperson_id"
    `);
  }
}
