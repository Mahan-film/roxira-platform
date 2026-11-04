import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DimensionKind } from '../enums/accounting.enum';

/** A floating detail account, cost centre or project centre a journal line can be tagged with. */
@Entity({ name: 'fin_dimensions' })
@Index('UQ_fin_dimensions_tenant_kind_code', ['tenantId', 'kind', 'code'], { unique: true })
export class DimensionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 12 })
  kind: DimensionKind;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** Parent cost centre (cost centres only); null at the top of the tree. */
  @Column({ type: 'integer', name: 'parent_id', nullable: true })
  parentId: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
