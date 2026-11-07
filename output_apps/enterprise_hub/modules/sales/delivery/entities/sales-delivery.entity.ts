import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A delivery note is created already POSTED: it moves stock and posts COGS in the same
 * transaction, so it has no draft state. The CHECK constraint allows only 'POSTED'.
 */
export type SalesDeliveryStatus = 'POSTED';

/**
 * One delivery note (حواله تحویل) of a confirmed sales order: a partial delivery against the
 * order's warehouse that consumed FIFO stock (`stockDocumentId`) and posted COGS
 * (`journalEntryId`) through the posting engine. `idempotencyKey` is the request identity: a
 * replayed POST returns the first delivery. Money columns are exact numeric strings, mapped as
 * `string` and converted only through `money.ts` in the service.
 */
@Entity({ name: 'erp_sales_deliveries' })
@Index('UQ_erp_sales_deliveries_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('IDX_erp_sales_deliveries_tenant_order', ['tenantId', 'orderId'])
export class SalesDeliveryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'int', name: 'order_id' })
  orderId: number;

  @Column({ type: 'varchar', length: 64, name: 'party_code' })
  partyCode: string;

  @Column({ type: 'int', name: 'warehouse_id' })
  warehouseId: number;

  @Column({ type: 'date', name: 'delivery_date' })
  deliveryDate: string;

  @Column({ type: 'varchar', length: 12, default: 'POSTED' })
  status: SalesDeliveryStatus;

  @Column({ type: 'varchar', length: 64, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'int', name: 'stock_document_id', nullable: true })
  stockDocumentId: number | null;

  @Column({ type: 'int', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'total_cost', default: 0 })
  totalCost: string;

  @Column({ type: 'varchar', length: 64, name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}

/**
 * One line of a delivery note. `quantity` is what left the warehouse at FIFO cost
 * (`lineCost`); `invoicedQuantity` and `returnedQuantity` are reserved for the invoicing and
 * return slices and are guarded by database CHECKs (`0 <= x <= quantity`).
 */
@Entity({ name: 'erp_sales_delivery_lines' })
@Index('UQ_erp_sales_delivery_lines_delivery_no', ['deliveryId', 'lineNo'], { unique: true })
@Index('IDX_erp_sales_delivery_lines_tenant_delivery', ['tenantId', 'deliveryId'])
@Index('IDX_erp_sales_delivery_lines_tenant_order_line', ['tenantId', 'orderLineId'])
export class SalesDeliveryLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int', name: 'delivery_id' })
  deliveryId: number;

  @Column({ type: 'int', name: 'line_no' })
  lineNo: number;

  @Column({ type: 'int', name: 'order_line_id' })
  orderLineId: number;

  @Column({ type: 'int', name: 'item_id' })
  itemId: number;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  quantity: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'line_cost', default: 0 })
  lineCost: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'invoiced_quantity', default: 0 })
  invoicedQuantity: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'returned_quantity', default: 0 })
  returnedQuantity: string;
}
