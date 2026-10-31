import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** TOTP enrolment of a user. The secret is stored encrypted (AES-256-GCM), recovery codes hashed. */
@Entity({ name: 'user_totp' })
export class UserTotpEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text', name: 'secret_enc' })
  secretEnc: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'text', array: true, name: 'recovery_hashes', default: () => "'{}'" })
  recoveryHashes: string[];

  /** Time step of the last accepted code; a code can never be used twice. */
  @Column({ type: 'bigint', name: 'last_used_step', nullable: true })
  lastUsedStep: string | null;

  @Column({ type: 'timestamp', name: 'enabled_at', nullable: true })
  enabledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
