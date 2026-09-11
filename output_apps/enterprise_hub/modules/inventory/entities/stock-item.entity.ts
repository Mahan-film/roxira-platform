import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * موجودیت کالای انبار (Stock Item) — نگاشت مستقیم به جدول موجود
 * `erp_stock_items`.
 *
 * `quantity` موجودی کل سازمانی کالا در همه انبارهاست و هم‌زمان با ورود/خروج
 * دسته‌های FIFO به‌صورت اتمیک به‌روزرسانی می‌شود. `minQuantity` آستانه هشدار
 * کسری است.
 *
 * تنها از طریق InventoryRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'erp_stock_items' })
export class StockItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  barcode: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'double precision', default: 0 })
  quantity: number;

  @Column({
    type: 'double precision',
    name: 'min_quantity',
    default: 0,
  })
  minQuantity: number;

  @Column({ type: 'varchar', length: 64, name: 'batch_number', nullable: true })
  batchNumber: string | null;
}
