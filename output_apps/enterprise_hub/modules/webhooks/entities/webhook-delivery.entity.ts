import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum WebhookDeliveryStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity({ name: 'sys_webhook_deliveries' })
@Index('IDX_sys_webhook_deliveries_tenant_created', ['tenantId', 'createdAt'])
@Index('IDX_sys_webhook_deliveries_tenant_expires', ['tenantId', 'expiresAt'])
@Index('IDX_sys_webhook_deliveries_tenant_subscription', ['tenantId', 'subscriptionId'])
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId: string;

  @Column({ type: 'varchar', length: 64, name: 'event_id' })
  eventId: string;

  @Column({ type: 'varchar', length: 64, name: 'event_type' })
  eventType: string;

  /** SHA-256 digest of the canonical payload (avoids retaining raw sensitive bodies). */
  @Column({ type: 'varchar', length: 64, name: 'payload_sha256' })
  payloadSha256: string;

  @Column({ type: 'varchar', length: 32, default: WebhookDeliveryStatus.PENDING })
  status: WebhookDeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'timestamp with time zone', name: 'next_attempt_at', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'integer', name: 'last_status_code', nullable: true })
  lastStatusCode: number | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp with time zone', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  /** Retention deadline for automated pruning of delivery logs. */
  @Column({ type: 'timestamp with time zone', name: 'expires_at' })
  expiresAt: Date;
}
