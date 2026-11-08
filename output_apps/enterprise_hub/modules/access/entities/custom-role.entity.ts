import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RoleScopeType, SensitiveField } from '../catalogue';

/**
 * Tenant-defined role (#584-3): a named list of catalogue permissions (`module:action`),
 * an optional scope (`org` | `branch` | `warehouse` + `scopeIds`), per-permission amount
 * limits (stored as exact decimal strings validated via `money.ts`), and field visibility
 * flags (`cost`, `margin`, `salary`).
 */
@Entity({ name: 'tenant_roles' })
@Index('UQ_tenant_roles_tenant_name', ['tenantId', 'name'], { unique: true })
export class CustomRoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  permissions: string[];

  @Column({ type: 'varchar', length: 20, name: 'scope_type', default: 'org' })
  scopeType: RoleScopeType;

  @Column({ type: 'uuid', array: true, name: 'scope_ids', default: () => "'{}'" })
  scopeIds: string[];

  @Column({ type: 'jsonb', name: 'amount_limits', default: () => "'{}'::jsonb" })
  amountLimits: Record<string, string>;

  @Column({ type: 'jsonb', name: 'field_visibility', default: () => "'{}'::jsonb" })
  fieldVisibility: Partial<Record<SensitiveField, boolean>>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
