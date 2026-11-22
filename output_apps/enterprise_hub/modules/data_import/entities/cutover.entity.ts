import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cutover go-live record (`data_import_cutovers`) — strictly tenant-scoped with FORCE RLS
 * and unique partial index enforcing at most one active cutover per tenant (#1217).
 */
@Entity({ name: 'data_import_cutovers' })
export class CutoverEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  // Note: cutoverDate and preCutoverLockDate are stored as ISO 'YYYY-MM-DD' text strings,
  // preserving strict binary compatibility with the existing table created by migration 1789900018000.
  @Column({ type: 'text', name: 'cutover_date' })
  cutoverDate: string;

  @Column({ type: 'text', name: 'pre_cutover_lock_date' })
  preCutoverLockDate: string;

  @Column({ type: 'integer', name: 'period_lock_id' })
  periodLockId: number;

  @Column({ type: 'integer', name: 'opening_journal_entry_id', nullable: true })
  openingJournalEntryId?: number | null;

  @Column({ type: 'text', name: 'legacy_number_prefix', default: 'LEGACY-' })
  legacyNumberPrefix: string;

  @Column({ type: 'boolean', name: 'is_go_live_active', default: true })
  isGoLiveActive: boolean;

  @Column({ type: 'text', name: 'executed_by', nullable: true })
  executedBy?: string | null;

  @Column({ type: 'jsonb', name: 'metadata', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
