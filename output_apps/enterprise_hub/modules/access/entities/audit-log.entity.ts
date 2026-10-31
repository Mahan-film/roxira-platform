import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit record. A database trigger rejects UPDATE, DELETE and
 * TRUNCATE, so history cannot be edited through the application.
 */
@Entity({ name: 'audit_log' })
export class AuditLogEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 60, name: 'resource_type', nullable: true })
  resourceType: string | null;

  @Column({ type: 'varchar', length: 80, name: 'resource_id', nullable: true })
  resourceId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null;

  /** Hash of the previous row of the same tenant (null for the first row and for tenant-less events). */
  @Column({ type: 'char', length: 64, name: 'prev_hash', nullable: true })
  prevHash: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  hash: string | null;

  @Index()
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
