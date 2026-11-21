import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AccountingPeriodState, PeriodCalendarType } from '../enums/accounting.enum';

/**
 * Accounting period with full lifecycle state (T178):
 * OPEN -> SOFT_LOCKED (with role exceptions) -> HARD_CLOSED (irreversible), plus ADJUSTMENT periods.
 */
@Entity({ name: 'fin_accounting_periods' })
@Index('UQ_fin_accounting_periods_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('IDX_fin_accounting_periods_tenant_dates', ['tenantId', 'periodStart', 'periodEnd'])
export class AccountingPeriodEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'fiscal_year_id', nullable: true })
  fiscalYearId: number | null;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'calendar_type',
    default: PeriodCalendarType.GREGORIAN,
  })
  calendarType: PeriodCalendarType;

  @Column({ type: 'date', name: 'period_start' })
  periodStart: string;

  @Column({ type: 'date', name: 'period_end' })
  periodEnd: string;

  @Column({ type: 'boolean', name: 'is_adjustment', default: false })
  isAdjustment: boolean;

  @Column({
    type: 'varchar',
    length: 16,
    default: AccountingPeriodState.OPEN,
  })
  state: AccountingPeriodState;

  @Column({ type: 'text', array: true, name: 'allowed_roles', default: () => "'{}'" })
  allowedRoles: string[];

  @Column({ type: 'varchar', length: 64, name: 'locked_by', nullable: true })
  lockedBy: string | null;

  @Column({ type: 'timestamptz', name: 'locked_at', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'text', name: 'lock_reason', nullable: true })
  lockReason: string | null;

  @Column({ type: 'varchar', length: 64, name: 'hard_closed_by', nullable: true })
  hardClosedBy: string | null;

  @Column({ type: 'timestamptz', name: 'hard_closed_at', nullable: true })
  hardClosedAt: Date | null;

  @Column({ type: 'text', name: 'hard_close_reason', nullable: true })
  hardCloseReason: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
