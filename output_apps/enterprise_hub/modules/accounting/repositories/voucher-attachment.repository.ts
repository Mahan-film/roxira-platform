import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';

/**
 * Persistence for journal-entry (voucher) attachments. Every query carries `tenant_id` and runs
 * inside TenantScope, so the FORCE row-level-security policy of `erp_journal_entry_attachments`
 * sees only the caller's tenant. BIGINT/size columns come back from `pg` as numbers here.
 */
export interface VoucherAttachmentRow {
  id: number;
  tenant_id: string;
  journal_entry_id: number;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: Date;
}

export interface VoucherAttachmentContentRow extends VoucherAttachmentRow {
  content: Buffer;
}

/** The voucher an attachment belongs to; only its date is needed for the period-lock check. */
export interface JournalEntryRef {
  id: number;
  date: Date;
}

/** TypeORM's postgres driver answers UPDATE/DELETE with `[rows, affected]`, everything else with `rows`. */
const rowsOf = (result: unknown): unknown[] => {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0];
  }
  return Array.isArray(result) ? result : [];
};

/** Unwraps the driver result shape and hands callers plain rows (never the `[rows, affected]` pair). */
const rows = <T>(result: unknown): T[] => rowsOf(result) as T[];

const COLUMNS =
  'id, tenant_id, journal_entry_id, file_name, content_type, size_bytes, uploaded_by, created_at';

@Injectable()
export class VoucherAttachmentRepository {
  constructor(private readonly scope: TenantScope) {}

  /** The voucher of this tenant, or null (another tenant's id is invisible under RLS). */
  findEntry(tenantId: string, journalEntryId: number, manager?: EntityManager): Promise<JournalEntryRef | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      const found = rows<JournalEntryRef>(
        await m.query(
          `SELECT id, date FROM fin_journal_entries WHERE tenant_id = $1 AND id = $2`,
          [tenantId, journalEntryId],
        ),
      );
      return found[0] ?? null;
    });
  }

  insert(
    tenantId: string,
    data: {
      journalEntryId: number;
      fileName: string;
      contentType: string;
      content: Buffer;
      uploadedBy: string;
    },
    manager?: EntityManager,
  ): Promise<VoucherAttachmentRow> {
    return this.scope.within(tenantId, manager, async (m) => {
      const inserted = rows<VoucherAttachmentRow>(
        await m.query(
          `INSERT INTO erp_journal_entry_attachments
             (tenant_id, journal_entry_id, file_name, content_type, size_bytes, content, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING ${COLUMNS}`,
          [
            tenantId,
            data.journalEntryId,
            data.fileName.slice(0, 255),
            data.contentType,
            data.content.length,
            data.content,
            data.uploadedBy.slice(0, 64),
          ],
        ),
      );
      return inserted[0];
    });
  }

  list(tenantId: string, journalEntryId: number): Promise<VoucherAttachmentRow[]> {
    return this.scope.within(tenantId, undefined, async (m) =>
      rows<VoucherAttachmentRow>(
        await m.query(
          `SELECT ${COLUMNS} FROM erp_journal_entry_attachments
            WHERE tenant_id = $1 AND journal_entry_id = $2 AND deleted_at IS NULL
            ORDER BY id`,
          [tenantId, journalEntryId],
        ),
      ),
    );
  }

  /** One attachment of this voucher only; a mismatched voucher id resolves to null (404 upstream). */
  findOne(tenantId: string, journalEntryId: number, attachmentId: number, manager?: EntityManager): Promise<VoucherAttachmentRow | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      const found = rows<VoucherAttachmentRow>(
        await m.query(
          `SELECT ${COLUMNS} FROM erp_journal_entry_attachments
            WHERE tenant_id = $1 AND journal_entry_id = $2 AND id = $3 AND deleted_at IS NULL`,
          [tenantId, journalEntryId, attachmentId],
        ),
      );
      return found[0] ?? null;
    });
  }

  /** Attachment with its bytes, for download. */
  findContent(
    tenantId: string,
    journalEntryId: number,
    attachmentId: number,
  ): Promise<VoucherAttachmentContentRow | null> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const found = rows<VoucherAttachmentContentRow>(
        await m.query(
          `SELECT ${COLUMNS}, content FROM erp_journal_entry_attachments
            WHERE tenant_id = $1 AND journal_entry_id = $2 AND id = $3 AND deleted_at IS NULL`,
          [tenantId, journalEntryId, attachmentId],
        ),
      );
      return found[0] ?? null;
    });
  }

  /** Soft delete; false when the attachment is gone or already deleted. */
  softDelete(tenantId: string, journalEntryId: number, attachmentId: number, manager?: EntityManager): Promise<boolean> {
    return this.scope.within(tenantId, manager, async (m) => {
      const updated = rows<{ id: number }>(
        await m.query(
          `UPDATE erp_journal_entry_attachments SET deleted_at = now()
            WHERE tenant_id = $1 AND journal_entry_id = $2 AND id = $3 AND deleted_at IS NULL
            RETURNING id`,
          [tenantId, journalEntryId, attachmentId],
        ),
      );
      return updated.length > 0;
    });
  }

  /** True when `date` falls inside an active period lock of this tenant (same predicate as posting). */
  isPeriodLocked(tenantId: string, date: Date, manager?: EntityManager): Promise<boolean> {
    return this.scope.within(tenantId, manager, async (m) => {
      const found = rows<{ one: number }>(
        await m.query(
          `SELECT 1 AS one FROM fin_period_locks
            WHERE tenant_id = $1 AND unlocked_at IS NULL
              AND CAST(CAST($2 AS timestamp) AS date) BETWEEN period_start AND period_end
            LIMIT 1`,
          [tenantId, date],
        ),
      );
      return found.length > 0;
    });
  }
}
