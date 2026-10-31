import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Invitation to join an organisation. Only the SHA-256 of the token is stored.
 * `email`/`phone` are optional hints (null = plain link). Staff joining this way
 * are never asked for an organisation name.
 */
@Entity({ name: 'tenant_invitations' })
export class InvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 40, name: 'role_key' })
  roleKey: string;

  @Column({ type: 'uuid', name: 'custom_role_id', nullable: true })
  customRoleId: string | null;

  @Column({ type: 'uuid', name: 'branch_id', nullable: true })
  branchId: string | null;

  @Column({ type: 'uuid', name: 'department_id', nullable: true })
  departmentId: string | null;

  @Column({ type: 'boolean', name: 'branch_scoped', default: false })
  branchScoped: boolean;

  @Index({ unique: true })
  @Column({ type: 'char', length: 64, name: 'token_hash' })
  tokenHash: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamp', name: 'accepted_at', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'uuid', name: 'accepted_by', nullable: true })
  acceptedBy: string | null;

  @Column({ type: 'timestamp', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'uuid', name: 'invited_by' })
  invitedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
