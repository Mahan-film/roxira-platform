import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T184 bank statement import (CAMT.053 / MT940):
 *   - `fin_bank_stmt_imports`: one row per uploaded file (audit and counts).
 *   - `fin_bank_stmt_lines`: booked movements. UNIQUE (tenant_id, bank_account_id, bank_txn_id) makes a
 *     second import of the same file (or an overlapping statement) create no duplicate line.
 * Both tables are tenant-scoped with ENABLE + FORCE ROW LEVEL SECURITY. The match tables follow in
 * 1789900011510.
 */
export class CreateBankStatementImport1789900011500 implements MigrationInterface {
  name = 'CreateBankStatementImport1789900011500';

  private readonly tables = ['fin_bank_stmt_imports', 'fin_bank_stmt_lines'];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_bank_stmt_imports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "bank_account_id" integer NOT NULL,
        "format" varchar(16) NOT NULL,
        "statement_id" varchar(128) NULL,
        "account_ref" varchar(64) NULL,
        "file_hash" varchar(64) NOT NULL,
        "line_count" integer NOT NULL,
        "new_line_count" integer NOT NULL,
        "imported_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_bank_stmt_imports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fin_bank_stmt_imports_account" FOREIGN KEY ("bank_account_id")
          REFERENCES "fin_bank_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fin_bank_stmt_imports_format" CHECK ("format" IN ('camt053', 'mt940'))
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_bank_stmt_imports_tenant_account"
        ON "fin_bank_stmt_imports" ("tenant_id", "bank_account_id", "created_at")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_bank_stmt_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "bank_account_id" integer NOT NULL,
        "import_id" uuid NOT NULL,
        "bank_txn_id" varchar(128) NOT NULL,
        "booking_date" date NOT NULL,
        "value_date" date NULL,
        "amount" numeric(18,2) NOT NULL,
        "direction" varchar(8) NOT NULL,
        "currency" varchar(8) NULL,
        "reference" text NOT NULL DEFAULT '',
        "counterparty" varchar(255) NULL,
        "status" varchar(16) NOT NULL DEFAULT 'unmatched',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_bank_stmt_lines" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fin_bank_stmt_lines_txn" UNIQUE ("tenant_id", "bank_account_id", "bank_txn_id"),
        CONSTRAINT "FK_fin_bank_stmt_lines_account" FOREIGN KEY ("bank_account_id")
          REFERENCES "fin_bank_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_fin_bank_stmt_lines_import" FOREIGN KEY ("import_id")
          REFERENCES "fin_bank_stmt_imports"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fin_bank_stmt_lines_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_fin_bank_stmt_lines_direction" CHECK ("direction" IN ('credit', 'debit')),
        CONSTRAINT "CHK_fin_bank_stmt_lines_status" CHECK ("status" IN ('unmatched', 'matched'))
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_bank_stmt_lines_tenant_account_status"
        ON "fin_bank_stmt_lines" ("tenant_id", "bank_account_id", "status", "booking_date")
    `);

    for (const table of this.tables) await enableTenantRls(q, table);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(q, table);
      await q.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
