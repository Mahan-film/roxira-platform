import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BomHeaderEntity } from './bom-header.entity';

@Entity({ name: 'erp_bom_items' })
@Index('IDX_erp_bom_items_tenant_bom', ['tenantId', 'bomId'])
@Index('IDX_erp_bom_items_tenant_component', ['tenantId', 'componentSku'])
export class BomItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int', name: 'bom_id' })
  bomId: number;

  @ManyToOne(() => BomHeaderEntity, (bom) => bom.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bom_id' })
  bom: BomHeaderEntity;

  @Column({ type: 'varchar', length: 100, name: 'component_sku' })
  componentSku: string;

  /** Multi-level BOM: reference to sub-assembly BOM if this component is itself produced */
  @Column({ type: 'int', name: 'sub_bom_id', nullable: true })
  subBomId: number | null;

  @ManyToOne(() => BomHeaderEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'sub_bom_id' })
  subBom: BomHeaderEntity | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  quantity: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'waste_percent',
    default: '0.00',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  wastePercent: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
