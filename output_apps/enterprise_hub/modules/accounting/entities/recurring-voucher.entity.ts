import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RecurringVoucherFrequency } from '../constants/recurring-voucher.constants';

/** One balanced journal line stored in a template; the shape of `JournalEntryLineDto`. */
export interface RecurringVoucherLine {
  accountCode: string;
  debit?: number | string;
  credit?: number | string;
  description?: string;
  currency?: string;
  amountFx?: number | string;
  fxRate?: number | string;
  partyCode?: string;
  detailCode?: string;
  costCenterCode?: string;
  projectCode?: string;
}

/**
 * A recurring voucher template. Maps to `erp_recurring_vouchers` (forced tenant RLS): every read
 * and write goes through RecurringVoucherRepository inside TenantScope.
 */
@Entity({ name: 'erp_recurring_vouchers' })
@Index('IDX_erp_recurring_vouchers_tenant_due', ['tenantId', 'active', 'nextRunDate'])
export class RecurringVoucherEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb' })
  lines: RecurringVoucherLine[];

  @Column({ type: 'varchar', length: 16 })
  frequency: RecurringVoucherFrequency;

  /** Gregorian `YYYY-MM-DD` of the next run; shown Jalali in the UI. */
  @Column({ type: 'date', name: 'next_run_date' })
  nextRunDate: string;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: string | null;

  @Column({ type: 'boolean', name: 'auto_reverse', default: false })
  autoReverse: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 64, name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}

/**
 * One run of a template. Maps to `erp_recurring_voucher_runs` (forced tenant RLS). The unique
 * (tenant, recurring, run_date) key is what makes a repeated run a no-op.
 */
@Entity({ name: 'erp_recurring_voucher_runs' })
@Index('UQ_erp_recurring_voucher_runs_tenant_recurring_date', ['tenantId', 'recurringId', 'runDate'], {
  unique: true,
})
export class RecurringVoucherRunEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'recurring_id' })
  recurringId: number;

  @Column({ type: 'date', name: 'run_date' })
  runDate: string;

  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'integer', name: 'reversal_entry_id', nullable: true })
  reversalEntryId: number | null;

  @Column({ type: 'date', name: 'reversal_date', nullable: true })
  reversalDate: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
