import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { StatementStatus } from '../enums/contracting.enum';

@Entity({ name: 'erp_progress_statements' })
@Index('UQ_erp_progress_statements_number', ['tenantId', 'contractId', 'number'], { unique: true })
@Index('UQ_erp_progress_statements_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('IDX_erp_progress_statements_tenant_contract_status', ['tenantId', 'contractId', 'status'])
export class ProgressStatementEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'contract_id' })
  contractId: number;

  @Column({ type: 'integer' })
  number: number;

  @Column({ type: 'date', name: 'statement_date' })
  statementDate: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'cumulative_amount' })
  cumulativeAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'previous_amount' })
  previousAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'period_amount' })
  periodAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'retention_amount', default: '0' })
  retentionAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'insurance_amount', default: '0' })
  insuranceAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'advance_recovery_amount', default: '0' })
  advanceRecoveryAmount: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: StatementStatus;

  @Column({ type: 'timestamp', name: 'approved_at', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamp', name: 'posted_at', nullable: true })
  postedAt: Date | null;

  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'journal_entry_number', nullable: true })
  journalEntryNumber: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
