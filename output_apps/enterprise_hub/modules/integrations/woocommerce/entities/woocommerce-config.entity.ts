import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'woocommerce_configs' })
@Index('UQ_woocommerce_configs_tenant', ['tenantId'], { unique: true })
export class WooCommerceConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 500, name: 'store_url' })
  storeUrl: string;

  @Column({ type: 'text', name: 'consumer_key_encrypted' })
  consumerKeyEncrypted: string;

  @Column({ type: 'text', name: 'consumer_secret_encrypted' })
  consumerSecretEncrypted: string;

  @Column({ type: 'text', name: 'webhook_secret' })
  webhookSecret: string;

  @Column({ type: 'boolean', name: 'auto_sync_orders', default: true })
  autoSyncOrders: boolean;

  @Column({ type: 'boolean', name: 'auto_sync_stock', default: true })
  autoSyncStock: boolean;

  @Column({ type: 'timestamptz', name: 'last_sync_at', nullable: true })
  lastSyncAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
