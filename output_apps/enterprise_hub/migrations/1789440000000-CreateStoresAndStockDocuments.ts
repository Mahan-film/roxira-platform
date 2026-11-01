import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores, warehouse grouping and stock documents.
 *
 * - `erp_stores`: a shop or branch that owns one or more warehouses. Code and name are unique
 *   per tenant.
 * - `erp_warehouses` gets `store_id` (optional, SET NULL when a store is removed) and `is_active`.
 * - `erp_stock_documents` / `erp_stock_document_lines`: one document per stock event (opening
 *   receipt, purchase receipt, sales delivery, adjustment, transfer). Every row carries
 *   `tenant_id`; the repository scopes each query by it. Purely additive.
 */
export class CreateStoresAndStockDocuments1789440000000 implements MigrationInterface {
  name = 'CreateStoresAndStockDocuments1789440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "erp_stores" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(100) NOT NULL,
        "address" character varying(512),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_stores_tenant_code" ON "erp_stores" ("tenant_id", "code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_stores_tenant_name" ON "erp_stores" ("tenant_id", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "erp_warehouses"
         ADD COLUMN IF NOT EXISTS "store_id" integer,
         ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "erp_warehouses"
         ADD CONSTRAINT "FK_erp_warehouses_store" FOREIGN KEY ("store_id")
           REFERENCES "erp_stores"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_warehouses_tenant_store" ON "erp_warehouses" ("tenant_id", "store_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "erp_stock_documents" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "doc_number" character varying(40) NOT NULL,
        "doc_type" character varying(24) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'POSTED',
        "doc_date" date NOT NULL,
        "from_warehouse_id" integer,
        "to_warehouse_id" integer,
        "reference" character varying(255),
        "note" character varying(512),
        "source_invoice_id" uuid,
        "journal_entry_id" integer,
        "created_by" character varying(64),
        "posted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_stock_documents_type" CHECK ("doc_type" IN ('OPENING','PURCHASE_RECEIPT','SALES_DELIVERY','ADJUSTMENT','TRANSFER')),
        CONSTRAINT "CHK_erp_stock_documents_status" CHECK ("status" IN ('DRAFT','POSTED')),
        CONSTRAINT "FK_erp_stock_documents_from" FOREIGN KEY ("from_warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_erp_stock_documents_to" FOREIGN KEY ("to_warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_stock_documents_tenant_number" ON "erp_stock_documents" ("tenant_id", "doc_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_stock_documents_tenant_type_date" ON "erp_stock_documents" ("tenant_id", "doc_type", "doc_date")`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "erp_stock_document_lines" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "document_id" integer NOT NULL,
        "item_id" integer,
        "sku" character varying(64) NOT NULL,
        "quantity" numeric(12,2) NOT NULL,
        "unit_cost" numeric(18,2) NOT NULL DEFAULT 0,
        "value" numeric(18,2) NOT NULL DEFAULT 0,
        "batch_number" character varying(100),
        CONSTRAINT "CHK_erp_stock_document_lines_qty" CHECK ("quantity" <> 0),
        CONSTRAINT "FK_erp_stock_document_lines_document" FOREIGN KEY ("document_id") REFERENCES "erp_stock_documents"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_stock_document_lines_tenant_doc" ON "erp_stock_document_lines" ("tenant_id", "document_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "erp_stock_document_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "erp_stock_documents"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_warehouses_tenant_store"`);
    await queryRunner.query(
      `ALTER TABLE "erp_warehouses"
         DROP CONSTRAINT IF EXISTS "FK_erp_warehouses_store",
         DROP COLUMN IF EXISTS "is_active",
         DROP COLUMN IF EXISTS "store_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "erp_stores"`);
  }
}
