import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED';

/**
 * A person's membership of one organisation. One user can hold many
 * (UNIQUE tenant_id + user_id). This table, not the JWT, decides access.
 */
@Entity({ name: 'tenant_memberships' })
@Index('UQ_tenant_memberships_tenant_user', ['tenantId', 'userId'], { unique: true })
export class MembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** System role key (owner, admin, ...) or `custom` together with `customRoleId`. */
  @Column({ type: 'varchar', length: 40, name: 'role_key' })
  roleKey: string;

  @Column({ type: 'uuid', name: 'custom_role_id', nullable: true })
  customRoleId: string | null;

  @Column({ type: 'uuid', name: 'branch_id', nullable: true })
  branchId: string | null;

  @Column({ type: 'uuid', name: 'department_id', nullable: true })
  departmentId: string | null;

  /** When true the member only sees data of `branchId`. */
  @Column({ type: 'boolean', name: 'branch_scoped', default: false })
  branchScoped: boolean;

  @Column({ type: 'varchar', length: 12, default: 'ACTIVE' })
  status: MembershipStatus;

  @Column({ type: 'uuid', name: 'invited_by', nullable: true })
  invitedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
