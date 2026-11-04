import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TreasuryDocKind, TreasuryDocStatus, TreasuryPartyType } from '../enums/treasury.enum';

/**
 * Receipt or payment document. Amounts are numeric(18,2) exact decimal strings (convert with
 * `fromDb`, never Number()). `advanceRemaining` is the part of `total` not yet allocated to
 * invoices; it falls as `TreasuryAllocationEntity` rows are added later.
 */
@Entity({ name: 'fin_treasury_documents' })
@Index('UQ_fin_treasury_documents_number', ['tenantId', 'kind', 'docNumber'], { unique: true })
@Index('IDX_fin_treasury_documents_party', ['tenantId', 'partyCode', 'docDate'])
export class TreasuryDocumentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: TreasuryDocKind;

  @Column({ type: 'varchar', length: 32, name: 'doc_number' })
  docNumber: string;

  @Column({ type: 'date', name: 'doc_date' })
  docDate: string;

  @Column({ type: 'varchar', length: 16, name: 'party_type' })
  partyType: TreasuryPartyType;

  @Column({ type: 'varchar', length: 64, name: 'party_code' })
  partyCode: string;

  @Column({ type: 'varchar', length: 128, name: 'party_name' })
  partyName: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  total: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'writeoff_total', default: 0 })
  writeoffTotal: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'advance_remaining', default: 0 })
  advanceRemaining: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 16, default: TreasuryDocStatus.POSTED })
  status: TreasuryDocStatus;

  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
