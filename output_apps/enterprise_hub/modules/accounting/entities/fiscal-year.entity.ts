import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { FiscalYearStatus } from '../enums/accounting.enum';

/** A tenant's fiscal year. Dates are Gregorian; the UI shows them in Jalali. */
@Entity({ name: 'fin_fiscal_years' })
@Index('UQ_fin_fiscal_years_tenant_start', ['tenantId', 'startDate'], { unique: true })
@Index('UQ_fin_fiscal_years_tenant_name', ['tenantId', 'name'], { unique: true })
export class FiscalYearEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32 })
  name: string;

  /** `date` columns come back from `pg` as 'YYYY-MM-DD' strings. */
  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  @Column({ type: 'date', name: 'end_date' })
  endDate: string;

  @Column({ type: 'varchar', length: 8, default: FiscalYearStatus.OPEN })
  status: FiscalYearStatus;

  /** Bumped on each close, so a close after a reopen gets fresh entry numbers. */
  @Column({ type: 'integer', name: 'close_seq', default: 0 })
  closeSeq: number;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'varchar', length: 64, name: 'closed_by', nullable: true })
  closedBy: string | null;

  @Column({ type: 'integer', name: 'period_lock_id', nullable: true })
  periodLockId: number | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
