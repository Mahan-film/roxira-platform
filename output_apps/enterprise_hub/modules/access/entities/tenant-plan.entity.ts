import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'tenant_plans' })
export class TenantPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', unique: true })
  tenantId!: string;

  @Column({ name: 'plan_key', type: 'varchar', length: 64, default: 'starter' })
  planKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  limits!: Record<string, number>;

  @Column({ name: 'rollover_day', type: 'smallint', default: 1 })
  rolloverDay!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
