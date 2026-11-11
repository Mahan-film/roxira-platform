import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BankCode } from '../../banking/enums/banking.enum';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { BankSmsDirection } from '../sms/bank-sms.types';

export enum TreasurySmsDraftStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

/**
 * Draft treasury receipt/payment captured from an Iranian bank SMS (T92).
 * Scoped by TenantScope and protected by FORCE ROW LEVEL SECURITY.
 */
@Entity({ name: 'fin_treasury_sms_drafts' })
@Index('IDX_fin_treasury_sms_drafts_tenant_status', ['tenantId', 'status'])
@Index('IDX_fin_treasury_sms_drafts_tenant_created', ['tenantId', 'createdAt'])
export class TreasurySmsDraftEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  bank: BankCode | null;

  @Column({ type: 'varchar', length: 64, name: 'bank_name_fa' })
  bankNameFa: string;

  @Column({ type: 'varchar', length: 16 })
  direction: BankSmsDirection;

  @Column({ type: 'varchar', length: 16, name: 'doc_kind' })
  docKind: TreasuryDocKind;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  balance: string | null;

  @Column({ type: 'varchar', length: 32, name: 'account_tail', nullable: true })
  accountTail: string | null;

  @Column({ type: 'varchar', length: 32, name: 'card_tail', nullable: true })
  cardTail: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  reference: string | null;

  @Column({ type: 'timestamptz', name: 'date_time', nullable: true })
  dateTime: Date | null;

  @Column({ type: 'text', name: 'raw_text' })
  rawText: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: TreasurySmsDraftStatus.DRAFT,
  })
  status: TreasurySmsDraftStatus;

  @Column({ type: 'integer', name: 'matched_document_id', nullable: true })
  matchedDocumentId: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
