import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PettyCashFundStatus, PettyCashKind, PettyCashStatus } from '../enums/accounting.enum';

/** A petty cash fund. Its balance is its ledger account; nothing here stores a balance. */
@Entity({ name: 'fin_petty_cash_funds' })
@Index('UQ_fin_petty_cash_funds_tenant_name', ['tenantId', 'name'], { unique: true })
@Index('UQ_fin_petty_cash_funds_tenant_account', ['tenantId', 'ledgerAccountId'], { unique: true })
export class PettyCashFundEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 128, name: 'custodian_name' })
  custodianName: string;

  @Column({ type: 'uuid', name: 'custodian_user_id', nullable: true })
  custodianUserId: string | null;

  @Column({ type: 'integer', name: 'ledger_account_id' })
  ledgerAccountId: number;

  /** Ceiling of the fund. */
  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'imprest_amount' })
  imprestAmount: string;

  @Column({ type: 'varchar', length: 8, default: PettyCashFundStatus.ACTIVE })
  status: PettyCashFundStatus;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}

@Entity({ name: 'fin_petty_cash_transactions' })
@Index('IDX_fin_petty_cash_tx_tenant_fund', ['tenantId', 'fundId', 'date'])
export class PettyCashTransactionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'fund_id' })
  fundId: number;

  @Column({ type: 'varchar', length: 8 })
  kind: PettyCashKind;

  @Column({ type: 'varchar', length: 8 })
  status: PettyCashStatus;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  /** Expense account of an EXPENSE; bank or cash account of a CHARGE or RETURN. */
  @Column({ type: 'varchar', length: 32, name: 'account_code' })
  accountCode: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 64, name: 'receipt_number', nullable: true })
  receiptNumber: string | null;

  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
