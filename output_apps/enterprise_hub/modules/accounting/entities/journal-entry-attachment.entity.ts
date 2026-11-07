import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Evidence attached to a journal entry (voucher). Bytes are stored in `content` (bytea); an
 * attachment is soft-deleted through `deleted_at` and never physically removed.
 *
 * The table carries FORCE tenant row-level security and is only reached through
 * VoucherAttachmentRepository inside TenantScope.
 */
@Entity({ name: 'erp_journal_entry_attachments' })
@Index('IDX_erp_journal_entry_attachments_voucher', ['tenantId', 'journalEntryId'])
export class JournalEntryAttachmentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'journal_entry_id' })
  journalEntryId: number;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName: string;

  @Column({ type: 'varchar', length: 64, name: 'content_type' })
  contentType: string;

  @Column({ type: 'integer', name: 'size_bytes' })
  sizeBytes: number;

  @Column({ type: 'bytea' })
  content: Buffer;

  @Column({ type: 'varchar', length: 64, name: 'uploaded_by' })
  uploadedBy: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
