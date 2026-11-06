import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** An advance payment or a retention release of a contract, posted once with its voucher. */
@Entity({ name: 'erp_contract_movements' })
@Index('IDX_erp_contract_movements_contract', ['tenantId', 'contractId', 'kind'])
export class ContractMovementEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'contract_id' })
  contractId: number;

  @Column({ type: 'varchar', length: 24 })
  kind: 'advance' | 'retention_release';

  @Column({ type: 'date', name: 'movement_date' })
  movementDate: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 64, name: 'request_key', nullable: true })
  requestKey: string | null;

  @Column({ type: 'jsonb', name: 'terms_snapshot', nullable: true })
  termsSnapshot: unknown | null;

  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'journal_entry_number', nullable: true })
  journalEntryNumber: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
