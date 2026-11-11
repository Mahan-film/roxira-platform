import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('invoice_payment_links')
@Index(['tenantId', 'invoiceId'])
@Index(['tenantId', 'gatewayRef'])
export class InvoicePaymentLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @Column({ type: 'varchar', length: 128, name: 'track_id', unique: true })
  trackId: string;

  @Column({ type: 'varchar', length: 512, name: 'payment_url' })
  paymentUrl: string;

  @Column({
    type: 'bigint',
    transformer: {
      to: (v: bigint) => (v !== undefined && v !== null ? v.toString() : '0'),
      from: (v: string) => (v ? BigInt(v) : 0n),
    },
  })
  amount: bigint;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status: string; // PENDING | PAID | FAILED

  @Column({ type: 'varchar', length: 32, default: 'zibal' })
  gateway: string;

  @Column({ type: 'varchar', length: 128, name: 'gateway_ref', nullable: true })
  gatewayRef?: string | null;

  @Column({ type: 'varchar', length: 32, name: 'card_number', nullable: true })
  cardNumber?: string | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
