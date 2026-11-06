import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProjectStatus } from '../enums/contracting.enum';

@Entity({ name: 'erp_projects' })
@Index('UQ_erp_projects_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('UQ_erp_projects_tenant_id', ['tenantId', 'id'], { unique: true })
export class ProjectEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 64, name: 'cost_centre_code', nullable: true })
  costCentreCode: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  budget: string;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: ProjectStatus;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
