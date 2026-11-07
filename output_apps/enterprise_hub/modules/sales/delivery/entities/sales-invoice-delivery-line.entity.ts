import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One link of invoice-from-delivery (#563 T1 slice 4): the invoice line `invoiceLineNo`
 * (1-based index into the invoice's `items` array) bills `quantity` of the delivery line
 * `deliveryLineId`. The delivery moved the stock and posted the COGS when it was posted, so the
 * invoice itself carries no stock link and posting books revenue and VAT only. `tenant_id` and
 * FORCE row-level security are the second wall behind the tenant-scoped queries.
 */
@Entity({ name: 'erp_sales_invoice_delivery_lines' })
@Index('UQ_erp_sales_invoice_delivery_lines_invoice_line', ['tenantId', 'invoiceId', 'invoiceLineNo'], {
  unique: true,
})
@Index('IDX_erp_sales_invoice_delivery_lines_tenant_delivery_line', ['tenantId', 'deliveryLineId'])
@Index('IDX_erp_sales_invoice_delivery_lines_tenant_invoice', ['tenantId', 'invoiceId'])
export class SalesInvoiceDeliveryLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @Column({ type: 'int', name: 'delivery_id' })
  deliveryId: number;

  @Column({ type: 'int', name: 'delivery_line_id' })
  deliveryLineId: number;

  @Column({ type: 'int', name: 'order_line_id' })
  orderLineId: number;

  @Column({ type: 'int', name: 'invoice_line_no' })
  invoiceLineNo: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  quantity: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
