import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Per-tenant treasury settings and document number counters. One row per tenant. */
@Entity({ name: 'fin_treasury_settings' })
export class TreasurySettingsEntity {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Largest difference written off per invoice; 0 forbids write-offs. */
  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'writeoff_tolerance', default: 0 })
  writeoffTolerance: string;

  @Column({ type: 'integer', name: 'next_receipt_no', default: 1 })
  nextReceiptNo: number;

  @Column({ type: 'integer', name: 'next_payment_no', default: 1 })
  nextPaymentNo: number;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
