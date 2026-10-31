import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank statement reconciliation assistant: upload sessions, statement items (BIGINT rial),
 * matches (one-to-many capable), tenant rules/settings, drafts, attachments, report snapshots
 * and an append-only audit log. Every table has `tenant_id`; the repository scopes every query
 * by it (AGENTS.md §4). Purely additive.
 */
export class CreateBankReconAssistant1789372000000 implements MigrationInterface {
  name = 'CreateBankReconAssistant1789372000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_sessions" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "bank_account_id" integer,
      "file_name" character varying(255) NOT NULL,
      "file_sha256" character(64) NOT NULL,
      "file_kind" character varying(8) NOT NULL,
      "file_data" bytea,
      "status" character varying(24) NOT NULL DEFAULT 'uploaded',
      "layout_id" character varying(64),
      "column_map" jsonb,
      "header_info" jsonb NOT NULL DEFAULT '{}',
      "checks" jsonb NOT NULL DEFAULT '[]',
      "confirmations" jsonb NOT NULL DEFAULT '{}',
      "period_from" date,
      "period_to" date,
      "opening_balance" bigint,
      "closing_balance" bigint,
      "created_by" character varying(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "committed_at" timestamptz,
      CONSTRAINT "FK_fin_bank_recon_sessions_account" FOREIGN KEY ("bank_account_id")
        REFERENCES "fin_bank_accounts"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_sessions_tenant" ON "fin_bank_recon_sessions" ("tenant_id", "bank_account_id", "period_from")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_bank_recon_sessions_file" ON "fin_bank_recon_sessions" ("tenant_id", "bank_account_id", "file_sha256") WHERE "status" <> 'discarded' AND "bank_account_id" IS NOT NULL`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_items" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "session_id" integer NOT NULL REFERENCES "fin_bank_recon_sessions"("id") ON DELETE CASCADE,
      "bank_account_id" integer NOT NULL,
      "line_no" integer NOT NULL,
      "txn_date" date NOT NULL,
      "txn_time" character varying(16),
      "description" text NOT NULL DEFAULT '',
      "withdrawal" bigint NOT NULL DEFAULT 0,
      "deposit" bigint NOT NULL DEFAULT 0,
      "balance" bigint,
      "reference" character varying(64),
      "cheque_no" character varying(16),
      "sayad_id" character varying(16),
      "dedupe_key" character varying(80) NOT NULL,
      "category" character varying(24),
      "person_type" character varying(8) NOT NULL DEFAULT 'unknown',
      "counterparty" character varying(80),
      "classification_confidence" numeric(4,3) NOT NULL DEFAULT 0,
      "classification_source" character varying(16) NOT NULL DEFAULT 'none',
      "counter_account_code" character varying(32),
      "status" character varying(16) NOT NULL DEFAULT 'open',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_fin_bank_recon_items_amounts" CHECK ("withdrawal" >= 0 AND "deposit" >= 0 AND ("withdrawal" = 0 OR "deposit" = 0))
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_items_session" ON "fin_bank_recon_items" ("tenant_id", "session_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_bank_recon_items_dedupe" ON "fin_bank_recon_items" ("tenant_id", "bank_account_id", "dedupe_key")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_matches" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "session_id" integer NOT NULL REFERENCES "fin_bank_recon_sessions"("id") ON DELETE CASCADE,
      "group_id" character varying(40) NOT NULL,
      "item_id" integer NOT NULL REFERENCES "fin_bank_recon_items"("id") ON DELETE CASCADE,
      "journal_line_id" integer NOT NULL REFERENCES "fin_journal_entry_lines"("id") ON DELETE CASCADE,
      "stage" character varying(16) NOT NULL,
      "confidence" numeric(4,3) NOT NULL,
      "status" character varying(12) NOT NULL DEFAULT 'suggested',
      "method" character varying(8) NOT NULL DEFAULT 'auto',
      "decided_by" character varying(64),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "decided_at" timestamptz
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_matches_session" ON "fin_bank_recon_matches" ("tenant_id", "session_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_bank_recon_matches_journal" ON "fin_bank_recon_matches" ("tenant_id", "journal_line_id") WHERE "status" = 'confirmed'`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_rules" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "kind" character varying(16) NOT NULL,
      "pattern" character varying(80) NOT NULL,
      "category" character varying(24) NOT NULL,
      "person_type" character varying(8),
      "counter_account_code" character varying(32),
      "source_item_id" integer,
      "hits" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true,
      "created_by" character varying(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_bank_recon_rules" ON "fin_bank_recon_rules" ("tenant_id", "kind", "pattern") WHERE "active"`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_settings" (
      "tenant_id" uuid PRIMARY KEY,
      "fee_max_rial" bigint NOT NULL DEFAULT 5000000,
      "sms_fee_max_rial" bigint NOT NULL DEFAULT 500000,
      "auto_post_fees" boolean NOT NULL DEFAULT false,
      "auto_match_min_confidence" numeric(4,3) NOT NULL DEFAULT 0.9,
      "date_window_days" integer NOT NULL DEFAULT 3,
      "category_accounts" jsonb NOT NULL DEFAULT '{}',
      "updated_by" character varying(64),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_fin_bank_recon_settings" CHECK ("fee_max_rial" >= 0 AND "sms_fee_max_rial" >= 0 AND "date_window_days" BETWEEN 0 AND 31 AND "auto_match_min_confidence" BETWEEN 0.5 AND 1)
    )`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_drafts" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "session_id" integer NOT NULL REFERENCES "fin_bank_recon_sessions"("id") ON DELETE CASCADE,
      "item_id" integer NOT NULL REFERENCES "fin_bank_recon_items"("id") ON DELETE CASCADE,
      "bank_account_id" integer NOT NULL,
      "entry_date" date NOT NULL,
      "description" character varying(255) NOT NULL,
      "amount" bigint NOT NULL,
      "direction" character varying(3) NOT NULL,
      "counter_account_code" character varying(32) NOT NULL,
      "category" character varying(24) NOT NULL,
      "status" character varying(12) NOT NULL DEFAULT 'draft',
      "journal_entry_id" integer,
      "reversal_entry_id" integer,
      "auto" boolean NOT NULL DEFAULT false,
      "failure_reason" text,
      "created_by" character varying(64) NOT NULL,
      "decided_by" character varying(64),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "decided_at" timestamptz,
      CONSTRAINT "CHK_fin_bank_recon_drafts_amount" CHECK ("amount" > 0)
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_bank_recon_drafts_live" ON "fin_bank_recon_drafts" ("tenant_id", "item_id") WHERE "status" IN ('draft','approved','posted')`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_drafts_session" ON "fin_bank_recon_drafts" ("tenant_id", "session_id", "status")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_attachments" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "item_id" integer NOT NULL REFERENCES "fin_bank_recon_items"("id") ON DELETE CASCADE,
      "file_name" character varying(255) NOT NULL,
      "mime" character varying(64) NOT NULL,
      "size_bytes" integer NOT NULL,
      "sha256" character(64) NOT NULL,
      "data" bytea NOT NULL,
      "uploaded_by" character varying(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_attachments_item" ON "fin_bank_recon_attachments" ("tenant_id", "item_id")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_reports" (
      "id" SERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "bank_account_id" integer NOT NULL,
      "session_id" integer,
      "period_from" date NOT NULL,
      "period_to" date NOT NULL,
      "difference_minor" bigint NOT NULL,
      "snapshot" jsonb NOT NULL,
      "created_by" character varying(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_reports_account" ON "fin_bank_recon_reports" ("tenant_id", "bank_account_id", "period_to")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "fin_bank_recon_audit" (
      "id" BIGSERIAL PRIMARY KEY,
      "tenant_id" uuid NOT NULL,
      "actor" character varying(64) NOT NULL,
      "action" character varying(48) NOT NULL,
      "subject_type" character varying(24) NOT NULL,
      "subject_id" character varying(40),
      "details" jsonb NOT NULL DEFAULT '{}',
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_recon_audit_tenant" ON "fin_bank_recon_audit" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION fin_guard_bank_recon_audit() RETURNS trigger AS $$
BEGIN
RAISE EXCEPTION 'bank reconciliation audit log is append-only' USING ERRCODE = 'RX002';
END;
$$ LANGUAGE plpgsql
`);
    await queryRunner.query(`
CREATE TRIGGER "TRG_fin_bank_recon_audit_guard"
BEFORE UPDATE OR DELETE ON "fin_bank_recon_audit"
FOR EACH ROW EXECUTE FUNCTION fin_guard_bank_recon_audit()
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_fin_bank_recon_audit_guard" ON "fin_bank_recon_audit"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fin_guard_bank_recon_audit()`);
    for (const table of [
      'fin_bank_recon_audit',
      'fin_bank_recon_reports',
      'fin_bank_recon_attachments',
      'fin_bank_recon_drafts',
      'fin_bank_recon_settings',
      'fin_bank_recon_rules',
      'fin_bank_recon_matches',
      'fin_bank_recon_items',
      'fin_bank_recon_sessions',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
