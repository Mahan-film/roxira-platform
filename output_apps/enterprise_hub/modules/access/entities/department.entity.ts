import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Department, optionally inside a branch. */
@Entity({ name: 'tenant_departments' })
export class DepartmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'branch_id', nullable: true })
  branchId: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
