import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invoice capture in the assistant chat (additive; nothing existing is touched).
 * Every table carries `tenant_id`; access checks live in the repository layer.
 *  - capture_documents: source + draft + status + model/cost; unique per tenant on the entry number
 *    and (partial) on the dedupe key of posted documents.
 *  - capture_files: the source image/PDF/audio shown beside the draft.
 *  - capture_vendors / capture_vendor_rules: seller lookup, account history, auto-post opt-in.
 *  - capture_settings: per-tenant auto mode (OFF by default), confidence threshold, cost caps.
 *  - capture_audit: append-only (trigger blocks UPDATE/DELETE).
 * Revert: `down()` drops the tables (captured drafts and the audit trail are lost: dump first).
 */
export class CreateInvoiceCapture1789375000000 implements MigrationInterface {
  name = 'CreateInvoiceCapture1789375000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "capture_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "source_kind" varchar(16) NOT NULL,
        "source_sha256" varchar(64) NOT NULL,
        "extracted" jsonb NOT NULL,
        "edited" jsonb,
        "confidence" numeric(4,3) NOT NULL DEFAULT 0,
        "field_confidence" jsonb NOT NULL DEFAULT '{}',
        "findings" jsonb NOT NULL DEFAULT '[]',
        "model" varchar(120),
        "cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
        "tokens_in" int NOT NULL DEFAULT 0,
        "tokens_out" int NOT NULL DEFAULT 0,
        "vendor_id" uuid,
        "dedupe_key" varchar(400),
        "journal_entry_id" int,
        "entry_number" varchar(64),
        "reversal_entry_id" int,
        "created_by" varchar(64) NOT NULL,
        "posted_by" varchar(64),
        "posted_at" timestamptz,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_capture_documents" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_capture_documents_status" CHECK ("status" IN
          ('draft','needs_review','posted','auto_posted','rejected','reversed'))
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_capture_documents_tenant_status"
      ON "capture_documents" ("tenant_id","status","created_at")`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_capture_documents_entry"
      ON "capture_documents" ("tenant_id","entry_number") WHERE "entry_number" IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_capture_documents_dedupe"
      ON "capture_documents" ("tenant_id","dedupe_key")
      WHERE "dedupe_key" IS NOT NULL AND "status" IN ('posted','auto_posted','reversed')`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_capture_documents_sha"
      ON "capture_documents" ("tenant_id","source_sha256")`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "capture_files" (
        "document_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "mime" varchar(64) NOT NULL,
        "bytes" bytea NOT NULL,
        CONSTRAINT "PK_capture_files" PRIMARY KEY ("document_id"),
        CONSTRAINT "FK_capture_files_doc" FOREIGN KEY ("document_id")
          REFERENCES "capture_documents"("id") ON DELETE CASCADE
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "capture_vendors" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "normalized_name" varchar(200) NOT NULL,
        "tax_id" varchar(16),
        "account_hits" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_capture_vendors" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_capture_vendors_tenant_name"
      ON "capture_vendors" ("tenant_id","normalized_name")`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_capture_vendors_tenant_tax"
      ON "capture_vendors" ("tenant_id","tax_id") WHERE "tax_id" IS NOT NULL`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "capture_vendor_rules" (
        "vendor_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "account_code" varchar(32) NOT NULL,
        "auto_post" boolean NOT NULL DEFAULT false,
        "max_amount_irr" numeric(18,2) NOT NULL,
        "updated_by" varchar(64) NOT NULL,
        CONSTRAINT "PK_capture_vendor_rules" PRIMARY KEY ("vendor_id"),
        CONSTRAINT "FK_capture_vendor_rules_vendor" FOREIGN KEY ("vendor_id")
          REFERENCES "capture_vendors"("id") ON DELETE CASCADE
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "capture_settings" (
        "tenant_id" uuid NOT NULL,
        "auto_enabled" boolean NOT NULL DEFAULT false,
        "min_confidence" numeric(4,3) NOT NULL DEFAULT 0.95,
        "daily_cost_cap_usd" numeric(8,2) NOT NULL DEFAULT 1,
        "daily_doc_cap" int NOT NULL DEFAULT 100,
        "updated_by" varchar(64),
        CONSTRAINT "PK_capture_settings" PRIMARY KEY ("tenant_id")
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "capture_audit" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "document_id" uuid NOT NULL,
        "action" varchar(32) NOT NULL,
        "actor" varchar(64) NOT NULL,
        "source_sha256" varchar(64),
        "model" varchar(120),
        "detail" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_capture_audit" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_capture_audit_tenant_doc"
      ON "capture_audit" ("tenant_id","document_id")`);
    await q.query(`
      CREATE OR REPLACE FUNCTION capture_audit_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'capture_audit is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(`DROP TRIGGER IF EXISTS "trg_capture_audit_append_only" ON "capture_audit"`);
    await q.query(`
      CREATE TRIGGER "trg_capture_audit_append_only"
        BEFORE UPDATE OR DELETE ON "capture_audit"
        FOR EACH ROW EXECUTE FUNCTION capture_audit_append_only()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS "trg_capture_audit_append_only" ON "capture_audit"`);
    await q.query(`DROP FUNCTION IF EXISTS capture_audit_append_only()`);
    for (const table of [
      'capture_audit',
      'capture_settings',
      'capture_vendor_rules',
      'capture_vendors',
      'capture_files',
      'capture_documents',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
