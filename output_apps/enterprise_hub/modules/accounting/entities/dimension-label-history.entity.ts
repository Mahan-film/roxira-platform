import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Historical effective-dated labels for dimensions (T181).
 * Preserves historical codes/names so reports on closed periods reflect the past name.
 */
@Entity({ name: 'fin_dimension_label_history' })
@Index('IDX_fin_dim_labels_lookup', ['tenantId', 'dimensionId', 'effectiveFrom', 'effectiveTo'])
export class DimensionLabelHistoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'dimension_id' })
  dimensionId: number;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'date', name: 'effective_from' })
  effectiveFrom: string;

  @Column({ type: 'date', name: 'effective_to', nullable: true })
  effectiveTo: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
