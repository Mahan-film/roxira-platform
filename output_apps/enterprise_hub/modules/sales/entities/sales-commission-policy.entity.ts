import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Sales representative commission rates per item category (#230 / T74).
 */
@Entity({ name: 'erp_sales_commission_policies' })
@Index('UQ_erp_sales_comm_tenant_category', ['tenantId', 'category'], { unique: true })
export class SalesCommissionPolicyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  category: string;

  /** Commission percentage for this category (e.g. 5.0 for 5%) */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'commission_rate',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  commissionRate: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
