import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Tenant-defined role: a named list of catalogue permissions (`module:action`). */
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
