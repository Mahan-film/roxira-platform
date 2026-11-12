import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WooCommerceSyncDirection {
  INBOUND_ORDER = 'inbound_order',
  OUTBOUND_STOCK = 'outbound_stock',
  OUTBOUND_PRICE = 'outbound_price',
}

export enum WooCommerceSyncStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Entity({ name: 'woocommerce_sync_logs' })
@Index('IDX_woocommerce_sync_logs_tenant_created', ['tenantId', 'createdAt'])
@Index('IDX_woocommerce_sync_logs_tenant_ext', ['tenantId', 'direction', 'externalId'])
@Index('UQ_wc_sync_logs_tenant_success', ['tenantId', 'direction', 'externalId'], {
  unique: true,
  where: `"status" = 'success'`,
})
export class WooCommerceSyncLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32 })
  direction: WooCommerceSyncDirection;

  @Column({ type: 'varchar', length: 16 })
  status: WooCommerceSyncStatus;

  @Column({ type: 'varchar', length: 128, name: 'external_id' })
  externalId: string;

  @Column({ type: 'varchar', length: 128, name: 'internal_id', nullable: true })
  internalId: string | null;

  @Column({ type: 'jsonb', name: 'payload_summary', default: {} })
  payloadSummary: Record<string, any>;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
