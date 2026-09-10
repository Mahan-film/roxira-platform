import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول invoices منطبق بر InvoiceEntity
 * (ماژول Smart Invoicing - enterprise-hub/invoicing).
 * پیاده‌سازی طبق قاعده Contract-First Synchronization (AGENTS.md بخش ۲.۴):
 * schema پیش از هرگونه تعامل کلاینت با API باید صریحاً از طریق Migration ایجاد شود
 * و هرگز به synchronize=true در محیط production تکیه نمی‌شود.
 */
export class CreateInvoicesTable1789037877166 implements MigrationInterface {
  name = 'CreateInvoicesTable1789037877166';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TYPE "public"."invoices_status_enum" AS ENUM('DRAFT', 'ISSUED', 'CANCELLED')`,
    );

    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "taxInvoiceNumber" character varying(64) NOT NULL,
        "sellerInfo" jsonb NOT NULL,
        "buyerInfo" jsonb NOT NULL,
        "items" jsonb NOT NULL,
        "totalAmount" numeric(18,2) NOT NULL,
        "totalDiscount" numeric(18,2) NOT NULL DEFAULT 0,
        "totalTax" numeric(18,2) NOT NULL DEFAULT 0,
        "finalPayable" numeric(18,2) NOT NULL,
        "status" "public"."invoices_status_enum" NOT NULL DEFAULT 'DRAFT',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoices_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_invoices_taxInvoiceNumber" ON "invoices" ("taxInvoiceNumber")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_status" ON "invoices" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_invoices_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_invoices_taxInvoiceNumber"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TYPE "public"."invoices_status_enum"`);
  }
}
