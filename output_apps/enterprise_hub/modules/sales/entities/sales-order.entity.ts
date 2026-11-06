import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SalesOrderStatus } from '../enums/sales-status.enum';

/**
 * A sales order (سفارش فروش) of the tenant: a confirmed intent to sell from a warehouse. It may
 * come from a converted quotation (`quotationId`) or be created directly. Money columns are exact
 * numeric strings, mapped as `string` and converted only through `money.ts` in the service.
 */
@Entity({ name: 'erp_sales_orders' })
@Index('UQ_erp_sales_orders_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('IDX_erp_sales_orders_tenant_party_status', ['tenantId', 'partyCode', 'status'])
export class SalesOrderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 64, name: 'party_code' })
  partyCode: string;

  @Column({ type: 'int', name: 'quotation_id', nullable: true })
  quotationId: number | null;

  @Column({ type: 'int', name: 'warehouse_id' })
  warehouseId: number;

  @Column({ type: 'date', name: 'order_date' })
  orderDate: string;

  @Column({ type: 'date', name: 'promised_date', nullable: true })
  promisedDate: string | null;

  @Column({ type: 'varchar', length: 12, default: SalesOrderStatus.DRAFT })
  status: SalesOrderStatus;

  @Column({ type: 'varchar', length: 512, nullable: true })
  note: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'total_amount', default: 0 })
  totalAmount: string;

  @Column({ type: 'varchar', length: 64, name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}

/**
 * One line of a sales order. `deliveredQuantity` and `invoicedQuantity` track fulfilment and are
 * guarded by database CHECKs (`0 <= x <= quantity`); a confirmed order with any delivery cannot be
 * cancelled.
 */
@Entity({ name: 'erp_sales_order_lines' })
@Index('UQ_erp_sales_order_lines_order_no', ['orderId', 'lineNo'], { unique: true })
@Index('IDX_erp_sales_order_lines_tenant_order', ['tenantId', 'orderId'])
export class SalesOrderLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int', name: 'order_id' })
  orderId: number;

  @Column({ type: 'int', name: 'line_no' })
  lineNo: number;

  @Column({ type: 'int', name: 'item_id' })
  itemId: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  quantity: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'unit_price' })
  unitPrice: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  discount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'line_total' })
  lineTotal: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'delivered_quantity', default: 0 })
  deliveredQuantity: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'invoiced_quantity', default: 0 })
  invoicedQuantity: string;
}
