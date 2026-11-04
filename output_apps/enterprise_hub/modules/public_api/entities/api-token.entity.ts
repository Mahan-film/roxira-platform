import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A tenant API token. Only the SHA-256 hash is stored (never the token). */
@Entity({ name: 'public_api_tokens' })
@Index('UQ_public_api_tokens_hash', ['tenantId', 'tokenHash'], { unique: true })
export class ApiTokenEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** First characters of the token, so people can tell tokens apart. Not secret. */
  @Column({ type: 'varchar', length: 24, name: 'token_prefix' })
  tokenPrefix: string;

  @Column({ type: 'char', length: 64, name: 'token_hash' })
  tokenHash: string;

  @Column({ type: 'text', array: true })
  scopes: string[];

  @Column({ type: 'integer', name: 'rate_limit_per_minute', default: 60 })
  rateLimitPerMinute: number;

  @Column({ type: 'varchar', length: 64, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'timestamp', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
