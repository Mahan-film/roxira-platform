import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales and purchase invoices with the Iranian e-invoice type and subject.
 *
 * - `direction`: SALE (we issue it) or PURCHASE (the supplier issued it to us).
 * - `einvoice_type`: 1 with buyer details, 2 without, 3 retail (Moadian `inty`).
 * - `subject`: 1 original, 2 corrective, 3 cancel, 4 return (Moadian `ins`).
 * - `related_invoice_id`: the invoice a corrective/cancel/return refers to (same tenant, enforced
 *   by the service; the FK only guarantees it exists).
 * - `warehouse_id`: the warehouse stock moves in/out of when the invoice posts.
 * - `posting_meta`: what posting recorded (FIFO cost of goods) so a cancel or return reverses
 *   exactly that amount instead of guessing from selling prices.
 *
 * Purely additive: every existing row becomes an original sales invoice of type 1.
 */
export class AddInvoiceDirectionAndSubject1789420000000 implements MigrationInterface {
  name = 'AddInvoiceDirectionAndSubject1789420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices"
         ADD COLUMN IF NOT EXISTS "direction" character varying(8) NOT NULL DEFAULT 'SALE',
         ADD COLUMN IF NOT EXISTS "einvoice_type" smallint NOT NULL DEFAULT 1,
         ADD COLUMN IF NOT EXISTS "subject" smallint NOT NULL DEFAULT 1,
         ADD COLUMN IF NOT EXISTS "related_invoice_id" uuid,
         ADD COLUMN IF NOT EXISTS "warehouse_id" integer,
         ADD COLUMN IF NOT EXISTS "posting_meta" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices"
         ADD CONSTRAINT "CHK_invoices_direction" CHECK ("direction" IN ('SALE','PURCHASE')),
         ADD CONSTRAINT "CHK_invoices_einvoice_type" CHECK ("einvoice_type" BETWEEN 1 AND 3),
         ADD CONSTRAINT "CHK_invoices_subject" CHECK ("subject" BETWEEN 1 AND 4),
         ADD CONSTRAINT "FK_invoices_related_invoice" FOREIGN KEY ("related_invoice_id")
           REFERENCES "invoices"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_direction" ON "invoices" ("tenant_id", "direction")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_related" ON "invoices" ("tenant_id", "related_invoice_id") WHERE "related_invoice_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invoices_tenant_related"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invoices_tenant_direction"`);
    await queryRunner.query(
      `ALTER TABLE "invoices"
         DROP CONSTRAINT IF EXISTS "FK_invoices_related_invoice",
         DROP CONSTRAINT IF EXISTS "CHK_invoices_subject",
         DROP CONSTRAINT IF EXISTS "CHK_invoices_einvoice_type",
         DROP CONSTRAINT IF EXISTS "CHK_invoices_direction",
         DROP COLUMN IF EXISTS "posting_meta",
         DROP COLUMN IF EXISTS "warehouse_id",
         DROP COLUMN IF EXISTS "related_invoice_id",
         DROP COLUMN IF EXISTS "subject",
         DROP COLUMN IF EXISTS "einvoice_type",
         DROP COLUMN IF EXISTS "direction"`,
    );
  }
}
