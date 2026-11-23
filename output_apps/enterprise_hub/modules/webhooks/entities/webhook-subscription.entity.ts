import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sys_webhook_subscriptions' })
@Index('UQ_sys_webhook_subscriptions_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('IDX_sys_webhook_subscriptions_tenant_active', ['tenantId', 'isActive'])
export class WebhookSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 1024 })
  url: string;

  /** AES-256-GCM encrypted HMAC signing secret (never stored in plaintext). */
  @Column({ type: 'text', name: 'secret_encrypted' })
  secretEncrypted: string;

  @Column({ type: 'jsonb', name: 'event_types', default: () => "'[]'::jsonb" })
  eventTypes: string[];

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp with time zone', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp with time zone', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;
}
