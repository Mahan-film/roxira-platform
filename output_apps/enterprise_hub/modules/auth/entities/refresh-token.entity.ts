import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Server-side refresh token. Only the SHA-256 of the token is stored.
 * Each use rotates the token inside its family; presenting an already-rotated
 * token revokes the whole family (stolen-token detection).
 * `user_id` is the owner and `tenant_id` the organisation at issue time.
 */
@Entity({ name: 'auth_refresh_tokens' })
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @Index({ unique: true })
  @Column({ type: 'char', length: 64, name: 'token_hash' })
  tokenHash: string;

  @Index()
  @Column({ type: 'uuid', name: 'family_id' })
  familyId: string;

  /** Device info captured at sign-in and carried through rotation; powers the session list. */
  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'char', length: 64, name: 'device_hash', nullable: true })
  deviceHash: string | null;

  /** True when this session passed a second factor (TOTP or passkey). */
  @Column({ type: 'boolean', default: false })
  mfa: boolean;

  @Column({ type: 'timestamp', name: 'session_started_at', nullable: true })
  sessionStartedAt: Date | null;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamp', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
