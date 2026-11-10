import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'fin_cash_transfers' })
export class CashTransferEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'cash_box_id' })
  cashBoxId: number;

  @Column({ type: 'integer', name: 'bank_account_id' })
  bankAccountId: number;

  @Column({ type: 'varchar', length: 16 })
  direction: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'integer', nullable: true, name: 'journal_entry_id' })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'idempotency_key' })
  idempotencyKey: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'idempotency_fingerprint' })
  idempotencyFingerprint: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
