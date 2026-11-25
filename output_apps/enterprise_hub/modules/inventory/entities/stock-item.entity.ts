import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { fromDb, fromMinor, minorToDecimal, Money, toMinor } from '../../accounting/money';
import { CostingMethod } from '../enums/costing-method.enum';

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
@Index('IDX_erp_stock_items_tenant_sku', ['tenantId', 'sku'], {
  unique: true,
})
@Index('IDX_erp_stock_items_tenant_barcode', ['tenantId', 'barcode'])
export class StockItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک کالا (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

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

  /** Primary stock keeping unit (e.g. piece, عدد) */
  @Column({ type: 'varchar', length: 32, name: 'primary_unit', default: 'piece' })
  primaryUnit?: string;

  /** Secondary unit of measure (e.g. carton, کارتن, بسته) */
  @Column({ type: 'varchar', length: 32, name: 'secondary_unit', nullable: true })
  secondaryUnit?: string | null;

  /** Conversion ratio: primaryQuantity = secondaryQuantity * unitRatio */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    name: 'unit_ratio',
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  unitRatio?: number | null;

  /** Attributes captured for this batch (up to 10 pairs) */
  @Column({ type: 'jsonb', nullable: true })
  attributes?: Record<string, string> | null;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'costing_method',
    default: CostingMethod.FIFO,
  })
  costingMethod: CostingMethod;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'standard_cost',
    nullable: true,
    transformer: {
      to: (value: Money | null | undefined) =>
        value === null || value === undefined ? null : minorToDecimal(toMinor(value)),
      from: (value: string | null) =>
        value === null ? null : fromMinor(fromDb(value)),
    },
  })
  standardCost?: Money | null;
}
