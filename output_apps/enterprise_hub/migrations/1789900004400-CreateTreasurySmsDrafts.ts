import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Bank SMS capture drafts (Task T92 / WAVE 9):
 *   - `fin_treasury_sms_drafts`: stores parsed incoming bank SMS receipts and payments.
 *   - Protected with `ENABLE` + `FORCE ROW LEVEL SECURITY`.
 */
export class CreateTreasurySmsDrafts1789900004400 implements MigrationInterface {
  name = 'CreateTreasurySmsDrafts1789900004400';

  private readonly tableName = 'fin_treasury_sms_drafts';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "bank" varchar(32) NULL,
        "bank_name_fa" varchar(64) NOT NULL,
        "direction" varchar(16) NOT NULL,
        "doc_kind" varchar(16) NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "balance" numeric(18,2) NULL,
        "account_tail" varchar(32) NULL,
        "card_tail" varchar(32) NULL,
        "reference" varchar(128) NULL,
        "date_time" timestamptz NULL,
        "raw_text" text NOT NULL,
        "sms_hash" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "matched_document_id" integer NULL REFERENCES "fin_treasury_documents"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_treasury_sms_drafts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fin_treasury_sms_drafts_tenant_hash" UNIQUE ("tenant_id", "sms_hash"),
        CONSTRAINT "CHK_fin_treasury_sms_drafts_status" CHECK ("status" IN ('draft', 'confirmed', 'rejected')),
        CONSTRAINT "CHK_fin_treasury_sms_drafts_direction" CHECK ("direction" IN ('deposit', 'withdraw')),
        CONSTRAINT "CHK_fin_treasury_sms_drafts_doc_kind" CHECK ("doc_kind" IN ('receipt', 'payment'))
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_treasury_sms_drafts_tenant_status"
        ON "${this.tableName}" ("tenant_id", "status")
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_treasury_sms_drafts_tenant_created"
        ON "${this.tableName}" ("tenant_id", "created_at")
    `);

    await enableTenantRls(q, this.tableName);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, this.tableName);
    await q.query(`DROP TABLE IF EXISTS "${this.tableName}"`);
  }
}
