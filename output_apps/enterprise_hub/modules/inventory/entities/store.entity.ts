import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A shop or branch that owns warehouses. Reached only through the inventory repositories, which
 * scope every query by `tenantId`.
 */
@Entity({ name: 'erp_stores' })
@Index('UQ_erp_stores_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('UQ_erp_stores_tenant_name', ['tenantId', 'name'], { unique: true })
export class StoreEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  address: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
