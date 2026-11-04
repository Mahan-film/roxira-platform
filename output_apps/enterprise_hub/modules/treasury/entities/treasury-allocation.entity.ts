import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AllocationTargetType } from '../enums/treasury.enum';

/**
 * Settlement of one invoice by one document. The open amount of an invoice is its payable minus
 * the sum of `amount + writeoff` over its allocation rows; ageing reads the same rows through
 * `TreasuryService.listAllocations` instead of guessing with FIFO.
 */
@Entity({ name: 'fin_treasury_allocations' })
@Index('IDX_fin_treasury_allocations_target', ['tenantId', 'targetType', 'targetId'])
@Index('IDX_fin_treasury_allocations_doc', ['tenantId', 'documentId'])
export class TreasuryAllocationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'document_id' })
  documentId: number;

  @Column({ type: 'varchar', length: 16, name: 'target_type', default: AllocationTargetType.INVOICE })
  targetType: AllocationTargetType;

  /** Invoice id (uuid) as a string; no foreign key into the laptop-owned invoicing tables. */
  @Column({ type: 'varchar', length: 64, name: 'target_id' })
  targetId: string;

  @Column({ type: 'varchar', length: 64, name: 'target_number', nullable: true })
  targetNumber: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  writeoff: string;

  @Column({ type: 'date', name: 'allocated_date' })
  allocatedDate: string;

  /** Entry that moved an earlier advance onto the invoice; null when the document posting did it. */
  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
