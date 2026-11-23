import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum IdempotencyKeyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

@Entity({ name: 'sys_idempotency_keys' })
@Index(
  'UQ_sys_idempotency_keys_tenant_scope_key',
  ['tenantId', 'scopeHash', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_sys_idempotency_keys_tenant_expires', ['tenantId', 'expiresAt'])
export class IdempotencyKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** SHA-256 hash scoping the key to HTTP method, route path, and authenticated actor. */
  @Column({ type: 'varchar', length: 64, name: 'scope_hash' })
  scopeHash: string;

  @Column({ type: 'varchar', length: 128, name: 'idempotency_key' })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64, name: 'fingerprint' })
  fingerprint: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'status',
    default: IdempotencyKeyStatus.IN_PROGRESS,
  })
  status: IdempotencyKeyStatus;

  @Column({ type: 'integer', name: 'response_status', nullable: true })
  responseStatus: number | null;

  @Column({
    type: 'text',
    name: 'response_body',
    nullable: true,
    transformer: {
      to: (value: unknown): string | null => {
        if (value === undefined || value === null) return null;
        return typeof value === 'string' ? value : JSON.stringify(value);
      },
      from: (value: string | null): unknown => {
        if (!value) return null;
        try {
          const safe = value.replace(/([:\[,]\s*)(-?\d{16,})\b/g, '$1"$2"');
          return JSON.parse(safe);
        } catch {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
      },
    },
  })
  responseBody: unknown;

  @Column({ type: 'timestamp with time zone', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp with time zone', name: 'expires_at' })
  expiresAt: Date;
}
