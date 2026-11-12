import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Print form builder templates (T81 / #592 WAVE 7).
 *
 * Adds:
 *   - `inv_print_templates`: per-tenant print templates for sales invoices,
 *     receipt/payment vouchers, stock documents, and barcode label sheets.
 *   - Supports sizes A4, A5, and 80 mm thermal with customizable logo,
 *     column selection, ordering, headers, and options.
 *   - Strict FORCE row-level security enabled.
 */
export class CreatePrintFormTemplates1789900004100 implements MigrationInterface {
  name = 'CreatePrintFormTemplates1789900004100';

  private static readonly TABLE = 'inv_print_templates';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inv_print_templates" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "doc_type" character varying(32) NOT NULL,
        "paper_size" character varying(16) NOT NULL,
        "title" character varying(128) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "show_logo" boolean NOT NULL DEFAULT true,
        "logo_url" character varying(512),
        "columns_config" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "options" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inv_print_templates_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inv_print_templates_tenant_title" UNIQUE ("tenant_id", "title"),
        CONSTRAINT "CHK_inv_print_templates_doc_type"
          CHECK ("doc_type" IN ('sales_invoice', 'receipt_payment_voucher', 'stock_document', 'barcode_labels')),
        CONSTRAINT "CHK_inv_print_templates_paper_size"
          CHECK ("paper_size" IN ('A4', 'A5', 'THERMAL_80MM'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_print_templates_lookup"
        ON "inv_print_templates" ("tenant_id", "doc_type", "paper_size")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_print_templates_tenant_default"
        ON "inv_print_templates" ("tenant_id", "doc_type", "is_default")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inv_print_templates_tenant_default"
        ON "inv_print_templates" ("tenant_id", "doc_type", "paper_size")
        WHERE "is_default" = true
    `);

    await enableTenantRls(queryRunner, CreatePrintFormTemplates1789900004100.TABLE);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await disableTenantRls(queryRunner, CreatePrintFormTemplates1789900004100.TABLE);
    await queryRunner.query(`DROP TABLE IF EXISTS "inv_print_templates"`);
  }
}
