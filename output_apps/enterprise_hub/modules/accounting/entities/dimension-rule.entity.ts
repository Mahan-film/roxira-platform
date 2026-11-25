import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dimension rule (T181):
 * - Rule condition: e.g. CostCenter required on P&L accounts,
 *   or Project required when CostCenter has a specific code (e.g. CC-RND).
 */
@Entity({ name: 'fin_dimension_rules' })
@Index('IDX_fin_dimension_rules_tenant', ['tenantId', 'active'])
export class DimensionRuleEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32, name: 'account_type', nullable: true })
  accountType: string | null;

  @Column({ type: 'varchar', length: 32, name: 'account_code', nullable: true })
  accountCode: string | null;

  @Column({ type: 'varchar', length: 32, name: 'when_dimension_kind', nullable: true })
  whenDimensionKind: string | null;

  @Column({ type: 'varchar', length: 32, name: 'when_dimension_code', nullable: true })
  whenDimensionCode: string | null;

  @Column({ type: 'varchar', length: 32, name: 'requires_dimension_kind' })
  requiresDimensionKind: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
