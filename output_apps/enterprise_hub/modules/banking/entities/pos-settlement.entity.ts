import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * رکوردهای تسویه کارت‌خوان بانکی (Task T54 / #230).
 */
@Entity({ name: 'fin_pos_settlements' })
@Index('IDX_fin_pos_settlements_tenant_date', ['tenantId', 'date'])
export class PosSettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'bank_account_id' })
  bankAccountId: number;

  @Column({ type: 'varchar', length: 64, name: 'terminal_number' })
  terminalNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'gross_amount' })
  grossAmount: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    name: 'fee_amount',
  })
  feeAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'net_amount' })
  netAmount: string;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    name: 'reference_number',
  })
  referenceNumber: string | null;

  @Column({ type: 'integer', nullable: true, name: 'journal_entry_id' })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'idempotency_key' })
  idempotencyKey: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'idempotency_fingerprint' })
  idempotencyFingerprint: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
