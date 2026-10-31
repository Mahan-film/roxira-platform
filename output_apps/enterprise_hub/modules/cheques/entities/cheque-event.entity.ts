import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ChequeStatus } from '../enums/cheque.enum';

/** Append-only history of a cheque's state changes and the journal entry each produced. */
@Entity({ name: 'fin_cheque_events' })
@Index('IDX_fin_cheque_events_tenant_cheque', ['tenantId', 'chequeId'])
export class ChequeEventEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'cheque_id' })
  chequeId: number;

  @Column({ type: 'varchar', length: 16, name: 'from_status', nullable: true })
  fromStatus: ChequeStatus | null;

  @Column({ type: 'varchar', length: 16, name: 'to_status' })
  toStatus: ChequeStatus;

  @Column({ type: 'date', name: 'event_date' })
  eventDate: string;

  /** Null when the move has no ledger effect. */
  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
