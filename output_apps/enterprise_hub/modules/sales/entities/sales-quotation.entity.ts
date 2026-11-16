import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SalesQuotationStatus } from '../enums/sales-status.enum';

/**
 * A quotation (پیش‌فاکتور) of the tenant: a priced offer to a customer, with one or more lines.
 * The number is unique per tenant; the party is referenced by its per-tenant code. Money is kept
 * as a string on purpose (exact numeric, never a float); conversion to minor units happens in the
 * service through `money.ts`.
 */
@Entity({ name: 'erp_sales_quotations' })
@Index('UQ_erp_sales_quotations_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('IDX_erp_sales_quotations_tenant_party_status', ['tenantId', 'partyCode', 'status'])
export class SalesQuotationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 64, name: 'party_code' })
  partyCode: string;

  @Column({ type: 'date', name: 'quote_date' })
  quoteDate: string;

  @Column({ type: 'date', name: 'valid_until', nullable: true })
  validUntil: string | null;

  @Column({ type: 'varchar', length: 12, default: SalesQuotationStatus.DRAFT })
  status: SalesQuotationStatus;

  @Index('IDX_erp_sales_quotations_tenant_invoice')
  @Column({ type: 'uuid', name: 'converted_invoice_id', nullable: true })
  convertedInvoiceId: string | null;

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

/** One line of a quotation. `lineNo` is 1-based and unique within the quotation. */
@Entity({ name: 'erp_sales_quotation_lines' })
@Index('UQ_erp_sales_quotation_lines_quotation_no', ['quotationId', 'lineNo'], { unique: true })
@Index('IDX_erp_sales_quotation_lines_tenant_quotation', ['tenantId', 'quotationId'])
export class SalesQuotationLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int', name: 'quotation_id' })
  quotationId: number;

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
}
