import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PayrollYearRates } from '../statutory/payroll-rates';
import { PayrollRunStatus } from '../enums/hr.enum';
import { numericTransformer } from './numeric-column.transformer';
import { PayslipEntity } from './payslip.entity';

/**
 * Monthly payroll run (`hr_payroll_runs`): one per tenant per Jalali month.
 *
 * A DRAFT run holds DRAFT payslips and can be recalculated; posting it creates
 * one balanced journal entry in accounting and marks the run POSTED (frozen).
 * Totals are a snapshot of the run's payslips.
 */
@Entity({ name: 'hr_payroll_runs' })
@Unique('UQ_hr_payroll_runs_tenant_period', [
  'tenantId',
  'periodYear',
  'periodMonth',
])
export class PayrollRunEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Owning tenant (only from the verified JWT). */
  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'period_year' })
  periodYear: number;

  @Column({ type: 'integer', name: 'period_month' })
  periodMonth: number;

  @Column({ type: 'varchar', length: 20, default: PayrollRunStatus.DRAFT })
  status: PayrollRunStatus;

  /** Jalali year of the statutory values used. */
  @Column({ type: 'integer', name: 'rates_year' })
  ratesYear: number;

  /** Statutory values the run was calculated with; exports read these, not current values. */
  @Column({ type: 'jsonb', name: 'rates_snapshot', nullable: true })
  ratesSnapshot: PayrollYearRates | null;

  /** Keys that were not verified when the run was calculated. */
  @Column({ type: 'jsonb', name: 'unverified_keys', default: () => "'[]'::jsonb" })
  unverifiedKeys: string[];

  @Column({ type: 'integer', name: 'employee_count', default: 0 })
  employeeCount: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_gross',
    default: 0,
    transformer: numericTransformer,
  })
  totalGross: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_insurable',
    default: 0,
    transformer: numericTransformer,
  })
  totalInsurable: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_employee_insurance',
    default: 0,
    transformer: numericTransformer,
  })
  totalEmployeeInsurance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_employer_insurance',
    default: 0,
    transformer: numericTransformer,
  })
  totalEmployerInsurance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_unemployment_insurance',
    default: 0,
    transformer: numericTransformer,
  })
  totalUnemploymentInsurance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_income_tax',
    default: 0,
    transformer: numericTransformer,
  })
  totalIncomeTax: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_other_deductions',
    default: 0,
    transformer: numericTransformer,
  })
  totalOtherDeductions: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_net',
    default: 0,
    transformer: numericTransformer,
  })
  totalNet: number;

  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'journal_entry_number',
    nullable: true,
  })
  journalEntryNumber: string | null;

  @Column({ type: 'timestamp', name: 'posted_at', nullable: true })
  postedAt: Date | null;

  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => PayslipEntity, (payslip) => payslip.payrollRun)
  payslips: PayslipEntity[];
}
