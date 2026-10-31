import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A tenant owner asking Roxira to enable a module. No money fields: sales happens outside the platform. */
@Entity({ name: 'tenant_module_requests' })
export class ModuleRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 40 })
  module: string;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy: string;

  @Column({ type: 'varchar', length: 12, default: 'OPEN' })
  status: 'OPEN' | 'DONE' | 'DECLINED';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
