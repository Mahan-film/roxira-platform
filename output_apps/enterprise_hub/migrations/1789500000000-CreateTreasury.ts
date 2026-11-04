import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Treasury: receipts and payments with their method lines, the allocation of money to invoices,
 * and per-tenant settings (write-off tolerance, document counters).
 *
 * Every table carries `tenant_id`, is created with FORCE row-level security in the same migration,
 * and is only reached through TreasuryRepository, which runs inside TenantScope. Purely additive.
 * Amounts are numeric(18,2) like the rest of the ledger.
 */
export class CreateTreasury1789500000000 implements MigrationInterface {
  name = 'CreateTreasury1789500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "fin_treasury_settings" (
        "tenant_id" uuid PRIMARY KEY,
        "writeoff_tolerance" numeric(18,2) NOT NULL DEFAULT 0,
        "next_receipt_no" integer NOT NULL DEFAULT 1,
        "next_payment_no" integer NOT NULL DEFAULT 1,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_treasury_settings_tolerance" CHECK ("writeoff_tolerance" >= 0)
      )`,
    );
    await q.query(
      `CREATE TABLE IF NOT EXISTS "fin_treasury_documents" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "doc_number" character varying(32) NOT NULL,
        "doc_date" date NOT NULL,
        "party_type" character varying(16) NOT NULL,
        "party_code" character varying(64) NOT NULL,
        "party_name" character varying(128) NOT NULL,
        "total" numeric(18,2) NOT NULL,
        "writeoff_total" numeric(18,2) NOT NULL DEFAULT 0,
        "advance_remaining" numeric(18,2) NOT NULL DEFAULT 0,
        "description" character varying(512),
        "status" character varying(16) NOT NULL DEFAULT 'posted',
        "journal_entry_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_treasury_documents_kind" CHECK ("kind" IN ('receipt','payment')),
        CONSTRAINT "CHK_fin_treasury_documents_party_type" CHECK ("party_type" IN ('customer','supplier')),
        CONSTRAINT "CHK_fin_treasury_documents_status" CHECK ("status" IN ('posted','reversed')),
        CONSTRAINT "CHK_fin_treasury_documents_total" CHECK ("total" > 0),
        CONSTRAINT "CHK_fin_treasury_documents_advance" CHECK ("advance_remaining" >= 0 AND "advance_remaining" <= "total"),
        CONSTRAINT "CHK_fin_treasury_documents_writeoff" CHECK ("writeoff_total" >= 0)
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_treasury_documents_number" ON "fin_treasury_documents" ("tenant_id", "kind", "doc_number")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_treasury_documents_party" ON "fin_treasury_documents" ("tenant_id", "party_code", "doc_date")`,
    );
    await q.query(
      `CREATE TABLE IF NOT EXISTS "fin_treasury_document_lines" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "document_id" integer NOT NULL,
        "method" character varying(16) NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "bank_account_id" integer,
        "cash_box_id" integer,
        "cheque_id" integer,
        "reference" character varying(128),
        CONSTRAINT "FK_fin_treasury_document_lines_doc" FOREIGN KEY ("document_id")
          REFERENCES "fin_treasury_documents"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fin_treasury_document_lines_method" CHECK ("method" IN ('cash','bank_transfer','card','cheque')),
        CONSTRAINT "CHK_fin_treasury_document_lines_amount" CHECK ("amount" > 0)
      )`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_treasury_document_lines_doc" ON "fin_treasury_document_lines" ("tenant_id", "document_id")`,
    );
    await q.query(
      `CREATE TABLE IF NOT EXISTS "fin_treasury_allocations" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "document_id" integer NOT NULL,
        "target_type" character varying(16) NOT NULL DEFAULT 'invoice',
        "target_id" character varying(64) NOT NULL,
        "target_number" character varying(64),
        "amount" numeric(18,2) NOT NULL,
        "writeoff" numeric(18,2) NOT NULL DEFAULT 0,
        "allocated_date" date NOT NULL,
        "journal_entry_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_fin_treasury_allocations_doc" FOREIGN KEY ("document_id")
          REFERENCES "fin_treasury_documents"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fin_treasury_allocations_target_type" CHECK ("target_type" IN ('invoice')),
        CONSTRAINT "CHK_fin_treasury_allocations_amounts" CHECK ("amount" >= 0 AND "writeoff" >= 0 AND ("amount" + "writeoff") > 0)
      )`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_treasury_allocations_target" ON "fin_treasury_allocations" ("tenant_id", "target_type", "target_id")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_treasury_allocations_doc" ON "fin_treasury_allocations" ("tenant_id", "document_id")`,
    );
    for (const table of TABLES) await enableTenantRls(q, table);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) await disableTenantRls(q, table);
    await q.query(`DROP TABLE IF EXISTS "fin_treasury_allocations"`);
    await q.query(`DROP TABLE IF EXISTS "fin_treasury_document_lines"`);
    await q.query(`DROP TABLE IF EXISTS "fin_treasury_documents"`);
    await q.query(`DROP TABLE IF EXISTS "fin_treasury_settings"`);
  }
}

const TABLES = [
  'fin_treasury_settings',
  'fin_treasury_documents',
  'fin_treasury_document_lines',
  'fin_treasury_allocations',
];
