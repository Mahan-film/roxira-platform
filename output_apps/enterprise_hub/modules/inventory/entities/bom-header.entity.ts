import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BomItemEntity } from './bom-item.entity';

@Entity({ name: 'erp_bom_headers' })
@Index('IDX_erp_bom_headers_tenant_code', ['tenantId', 'bomCode'], { unique: true })
@Index('IDX_erp_bom_headers_tenant_sku', ['tenantId', 'finishedItemSku'])
export class BomHeaderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64, name: 'bom_code' })
  bomCode: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, name: 'finished_item_sku' })
  finishedItemSku: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    name: 'output_quantity',
    default: '1.000',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 1 : Number(v)),
    },
  })
  outputQuantity: number;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => BomItemEntity, (item) => item.bom, { cascade: true })
  items: BomItemEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
