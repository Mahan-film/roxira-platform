import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { StockDocumentStatus, StockDocumentType } from '../enums/stock-document.enum';

const numeric = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

/** One stock event (opening receipt, receipt, delivery, adjustment or transfer). */
@Entity({ name: 'erp_stock_documents' })
@Index('UQ_erp_stock_documents_tenant_number', ['tenantId', 'docNumber'], { unique: true })
@Index('IDX_erp_stock_documents_tenant_type_date', ['tenantId', 'docType', 'docDate'])
export class StockDocumentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 40, name: 'doc_number' })
  docNumber: string;

  @Column({ type: 'varchar', length: 24, name: 'doc_type' })
  docType: StockDocumentType;

  @Column({ type: 'varchar', length: 12, default: StockDocumentStatus.POSTED })
  status: StockDocumentStatus;

  /** Calendar date of the document, `YYYY-MM-DD`. */
  @Column({ type: 'date', name: 'doc_date' })
  docDate: string;

  @Column({ type: 'int', name: 'from_warehouse_id', nullable: true })
  fromWarehouseId: number | null;

  @Column({ type: 'int', name: 'to_warehouse_id', nullable: true })
  toWarehouseId: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  note: string | null;

  @Column({ type: 'uuid', name: 'source_invoice_id', nullable: true })
  sourceInvoiceId: string | null;

  @Column({ type: 'int', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamp', name: 'posted_at', nullable: true })
  postedAt: Date | null;

  /** Draft documents: who reviewed the current lines and when (cleared when the lines change). */
  @Column({ type: 'varchar', length: 64, name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'timestamp', name: 'reviewed_at', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}

/** One line of a stock document. `quantity` is signed for adjustments. */
@Entity({ name: 'erp_stock_document_lines' })
@Index('IDX_erp_stock_document_lines_tenant_doc', ['tenantId', 'documentId'])
export class StockDocumentLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int', name: 'document_id' })
  documentId: number;

  @Column({ type: 'int', name: 'item_id', nullable: true })
  itemId: number | null;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric })
  quantity: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'unit_cost', default: 0, transformer: numeric })
  unitCost: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numeric })
  value: number;

  @Column({ type: 'varchar', length: 100, name: 'batch_number', nullable: true })
  batchNumber: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'secondary_quantity',
    nullable: true,
    transformer: numeric,
  })
  secondaryQuantity?: number | null;

  @Column({ type: 'jsonb', name: 'serial_numbers', nullable: true })
  serialNumbers?: string[] | null;
}
