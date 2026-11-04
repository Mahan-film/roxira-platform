import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per source document that was posted by the engine: the idempotency key
 * (tenant, source type, source id, doc type) and the vouchers it produced.
 */
@Entity({ name: 'fin_posting_sources' })
@Index('UQ_fin_posting_sources', ['tenantId', 'sourceType', 'sourceId', 'docType'], { unique: true })
export class PostingSourceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 48, name: 'source_type' })
  sourceType: string;

  @Column({ type: 'varchar', length: 64, name: 'source_id' })
  sourceId: string;

  @Column({ type: 'varchar', length: 48, name: 'doc_type' })
  docType: string;

  /** Null only while the voucher is being created inside the same transaction. */
  @Column({ type: 'integer', name: 'entry_id', nullable: true })
  entryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'entry_number', nullable: true })
  entryNumber: string | null;

  @Column({ type: 'integer', name: 'reversal_entry_id', nullable: true })
  reversalEntryId: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
