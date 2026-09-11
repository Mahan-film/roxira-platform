import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * یک دسته (لایه) FIFO از موجودی کالا — نگاشت مستقیم به جدول موجود
 * `inventory_fifo_batches`.
 *
 * هر ورود کالا یک ردیف جدید با `unitPurchaseCost` خودش می‌سازد و خروج کالا
 * به‌ترتیب `receivedDate` صعودی از قدیمی‌ترین دسته‌ها مصرف می‌کند
 * (First-In, First-Out). `warehouseId` مشخص می‌کند دسته در کدام انبار فیزیکی
 * قرار دارد؛ `null` یعنی دسته بدون انبار مشخص (داده‌های قدیمی).
 *
 * ستون‌های numeric درایور Postgres به‌صورت رشته برمی‌گردند؛ Transformer
 * آن‌ها را به عدد تبدیل می‌کند تا محاسبات FIFO دقیق بماند.
 *
 * تنها از طریق InventoryRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'inventory_fifo_batches' })
export class FifoBatchEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  sku: string;

  @Column({ type: 'varchar', length: 100, name: 'batch_number' })
  batchNumber: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'quantity_remaining',
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? 0 : Number(value)),
    },
  })
  quantityRemaining: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'unit_purchase_cost',
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? 0 : Number(value)),
    },
  })
  unitPurchaseCost: number;

  @Index()
  @Column({
    type: 'timestamp',
    name: 'received_date',
    default: () => 'CURRENT_TIMESTAMP',
  })
  receivedDate: Date;

  @Index()
  @Column({ type: 'integer', name: 'warehouse_id', nullable: true })
  warehouseId: number | null;
}
