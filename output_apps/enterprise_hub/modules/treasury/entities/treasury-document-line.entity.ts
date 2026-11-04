import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TreasuryMethod } from '../enums/treasury.enum';

/** One payment method of a document (a mixed document has several). */
@Entity({ name: 'fin_treasury_document_lines' })
@Index('IDX_fin_treasury_document_lines_doc', ['tenantId', 'documentId'])
export class TreasuryDocumentLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'document_id' })
  documentId: number;

  @Column({ type: 'varchar', length: 16 })
  method: TreasuryMethod;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  /** `fin_bank_accounts.id` for bank transfer and card lines. */
  @Column({ type: 'integer', name: 'bank_account_id', nullable: true })
  bankAccountId: number | null;

  /** Cash box (TRS-2); the cash box table lands in the next PR, so no foreign key yet. */
  @Column({ type: 'integer', name: 'cash_box_id', nullable: true })
  cashBoxId: number | null;

  /** `fin_cheques.id`, registered through the cheques module by this document. */
  @Column({ type: 'integer', name: 'cheque_id', nullable: true })
  chequeId: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  reference: string | null;
}
