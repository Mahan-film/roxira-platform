import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Evidence attached to a journal entry (voucher): receipts, invoices and scans that arrive after
 * the voucher is posted. The bytes live in the table (`content`, bytea) exactly like the bank
 * reconciliation attachments; the same 5 MB size cap and PDF/image/Excel/CSV type allow-list apply.
 *
 * The table carries `tenant_id`, is created with FORCE row-level security in the same migration,
 * and is only reached through VoucherAttachmentRepository, which runs inside TenantScope. An
 * attachment is soft-deleted (`deleted_at`) so the audit trail is never destroyed. Purely additive.
 */
export class CreateJournalEntryAttachments1789900000200 implements MigrationInterface {
  name = 'CreateJournalEntryAttachments1789900000200';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_journal_entry_attachments" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "journal_entry_id" integer NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(64) NOT NULL,
        "size_bytes" integer NOT NULL,
        "content" bytea NOT NULL,
        "uploaded_by" character varying(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "FK_erp_journal_entry_attachments_entry" FOREIGN KEY ("journal_entry_id")
          REFERENCES "fin_journal_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_erp_journal_entry_attachments_size" CHECK ("size_bytes" >= 0),
        CONSTRAINT "CHK_erp_journal_entry_attachments_name" CHECK ("file_name" <> '')
      )`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_journal_entry_attachments_voucher"
        ON "erp_journal_entry_attachments" ("tenant_id", "journal_entry_id")`,
    );
    await enableTenantRls(q, 'erp_journal_entry_attachments');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_journal_entry_attachments');
    await q.query(`DROP TABLE IF EXISTS "erp_journal_entry_attachments"`);
  }
}
