import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BomHeaderEntity } from './bom-header.entity';

export enum ProductionOrderStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'erp_production_orders' })
@Index('IDX_erp_production_orders_tenant_num', ['tenantId', 'orderNumber'], { unique: true })
@Index('IDX_erp_production_orders_tenant_status', ['tenantId', 'status'])
export class ProductionOrderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64, name: 'order_number' })
  orderNumber: string;

  @Column({ type: 'int', name: 'bom_id' })
  bomId: number;

  @ManyToOne(() => BomHeaderEntity)
  @JoinColumn({ name: 'bom_id' })
  bom: BomHeaderEntity;

  @Column({ type: 'varchar', length: 100, name: 'finished_sku' })
  finishedSku: string;

  @Column({ type: 'int', name: 'warehouse_id', nullable: true })
  warehouseId: number | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    name: 'planned_quantity',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  plannedQuantity: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    name: 'completed_quantity',
    default: '0.000',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  completedQuantity: number;

  @Column({
    type: 'varchar',
    length: 32,
    default: ProductionOrderStatus.DRAFT,
  })
  status: ProductionOrderStatus;

  @Column({
    type: 'bigint',
    name: 'total_cost_minor',
    default: '0',
    transformer: {
      to: (v: bigint | number) => v.toString(),
      from: (v: string | null) => (v === null ? 0n : BigInt(v)),
    },
  })
  totalCostMinor: bigint;

  @Column({
    type: 'bigint',
    name: 'unit_cost_minor',
    default: '0',
    transformer: {
      to: (v: bigint | number) => v.toString(),
      from: (v: string | null) => (v === null ? 0n : BigInt(v)),
    },
  })
  unitCostMinor: bigint;

  @Column({ type: 'int', name: 'voucher_id', nullable: true })
  voucherId: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
