import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * موجودیت کات‌اوور و وضعیت ورود به عملیات زنده (Cutover Entity).
 * نگهداری وضعیت Cutover Wizard شامل تاریخ کات‌اوور، تاریخ قفل دوره پیش از کات‌اوور،
 * شناسه قفل دوره، سند افتتاحیه، و پیشوند سری شماره‌های موروثی (R32 D4/D5).
 */
@Entity({ name: 'data_import_cutovers' })
@Index('IDX_data_import_cutovers_tenant', ['tenantId'])
export class CutoverEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 10, name: 'cutover_date' })
  cutoverDate: string;

  @Column({ type: 'varchar', length: 10, name: 'pre_cutover_lock_date' })
  preCutoverLockDate: string;

  @Column({ type: 'integer', name: 'period_lock_id' })
  periodLockId: number;

  @Column({ type: 'integer', name: 'opening_journal_entry_id', nullable: true })
  openingJournalEntryId?: number | null;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'legacy_number_prefix',
    default: 'LEGACY-',
  })
  legacyNumberPrefix: string;

  @Column({ type: 'boolean', name: 'is_go_live_active', default: true })
  isGoLiveActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
