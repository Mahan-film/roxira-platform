import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PayslipStatus } from '../enums/hr.enum';
import { numericTransformer } from './numeric-column.transformer';
import { PayrollAllowance } from '../services/payroll-calculator';
import { EmployeeEntity } from './employee.entity';
import { PayrollRunEntity } from './payroll-run.entity';

/**
 * فیش حقوقی ماهانه (Payroll Payslip).
 *
 * نگاشت مستقیم به جدول `hr_payslips`. مبالغ اجزای حقوق، کسورات بیمه و
 * مالیات و خالص پرداختی به‌صورت snapshot در هر فیش ذخیره می‌شوند تا حتی با
 * تغییر قرارداد، سابقه حقوقی دست‌نخورده بماند. برای هر کارمند در هر
 * دوره (سال/ماه) تنها یک فیش مجاز است (Unique Constraint).
 *
 * `journalEntryId` شناسه سند اتوماتیک هزینه حقوق در دفتر روزنامه
 * حسابداری است که هنگام صدور فیش ثبت می‌شود.
 */
@Entity({ name: 'hr_payslips' })
@Index('IDX_hr_payslips_tenant_payslip_number', ['tenantId', 'payslipNumber'], {
  unique: true,
})
@Unique('UQ_hr_payslips_tenant_employee_period', [
  'tenantId',
  'employeeId',
  'periodYear',
  'periodMonth',
])
export class PayslipEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک فیش حقوقی (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64, name: 'payslip_number' })
  payslipNumber: string;

  @Index()
  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, (employee) => employee.payslips, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'employee_id' })
  employee: EmployeeEntity;

  @Index()
  @Column({ type: 'integer', name: 'contract_id', nullable: true })
  contractId: number | null;

  @Index()
  @Column({ type: 'integer', name: 'period_year' })
  periodYear: number;

  @Index()
  @Column({ type: 'integer', name: 'period_month' })
  periodMonth: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'base_salary',
    transformer: numericTransformer,
  })
  baseSalary: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'housing_allowance',
    default: 0,
    transformer: numericTransformer,
  })
  housingAllowance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'food_allowance',
    default: 0,
    transformer: numericTransformer,
  })
  foodAllowance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'child_allowance',
    default: 0,
    transformer: numericTransformer,
  })
  childAllowance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'overtime_amount',
    default: 0,
    transformer: numericTransformer,
  })
  overtimeAmount: number;

  /** Payroll run this payslip belongs to (null for single legacy payslips). */
  @Index()
  @Column({ type: 'integer', name: 'payroll_run_id', nullable: true })
  payrollRunId: number | null;

  @ManyToOne(() => PayrollRunEntity, (run) => run.payslips, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'payroll_run_id' })
  payrollRun?: PayrollRunEntity;

  /** Seniority base (پایه سنوات). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'seniority_amount',
    default: 0,
    transformer: numericTransformer,
  })
  seniorityAmount: number;

  /** Night-shift premium (35%). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'night_shift_amount',
    default: 0,
    transformer: numericTransformer,
  })
  nightShiftAmount: number;

  /** Holiday / Friday work (+40%). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'holiday_amount',
    default: 0,
    transformer: numericTransformer,
  })
  holidayAmount: number;

  /** Unpaid absence deduction. */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'absence_deduction',
    default: 0,
    transformer: numericTransformer,
  })
  absenceDeduction: number;

  /** Wage subject to social-security premium (capped). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'insurable_wage',
    default: 0,
    transformer: numericTransformer,
  })
  insurableWage: number;

  /** Employer social-security share (20%). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'employer_insurance',
    default: 0,
    transformer: numericTransformer,
  })
  employerInsurance: number;

  /** Unemployment insurance, employer-paid (3%). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'unemployment_insurance',
    default: 0,
    transformer: numericTransformer,
  })
  unemploymentInsurance: number;

  /** Paid days in the month (insurance list). */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'work_days',
    default: 0,
    transformer: numericTransformer,
  })
  workDays: number;

  /** Overtime hours entered for the run. */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'overtime_hours',
    default: 0,
    transformer: numericTransformer,
  })
  overtimeHours: number;

  /** Night-shift hours entered for the run. */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'night_hours',
    default: 0,
    transformer: numericTransformer,
  })
  nightHours: number;

  /** Holiday hours entered for the run. */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'holiday_hours',
    default: 0,
    transformer: numericTransformer,
  })
  holidayHours: number;

  /** Unpaid absence days entered for the run. */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'absence_days',
    default: 0,
    transformer: numericTransformer,
  })
  absenceDays: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'gross_pay',
    transformer: numericTransformer,
  })
  grossPay: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'insurance_deduction',
    default: 0,
    transformer: numericTransformer,
  })
  insuranceDeduction: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'income_tax',
    default: 0,
    transformer: numericTransformer,
  })
  incomeTax: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'other_deductions',
    default: 0,
    transformer: numericTransformer,
  })
  otherDeductions: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'net_pay',
    transformer: numericTransformer,
  })
  netPay: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'marriage_allowance',
    default: 0,
    transformer: numericTransformer,
  })
  marriageAllowance: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'allowances_total',
    default: 0,
    transformer: numericTransformer,
  })
  allowancesTotal: number;

  /** Contract allowances as paid this month, with their insurance and tax treatment. */
  @Column({ type: 'jsonb', name: 'allowance_lines', default: () => "'[]'::jsonb" })
  allowanceLines: PayrollAllowance[];

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'eidi_amount',
    default: 0,
    transformer: numericTransformer,
  })
  eidiAmount: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'non_cash_amount',
    default: 0,
    transformer: numericTransformer,
  })
  nonCashAmount: number;

  /** Income of this month that joined the cumulative progressive base. */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'taxable_income',
    default: 0,
    transformer: numericTransformer,
  })
  taxableIncome: number;

  /** Part of `incomeTax` from flat-rate allowances. */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'flat_tax',
    default: 0,
    transformer: numericTransformer,
  })
  flatTax: number;

  /** Calendar days of the Jalali month this payslip was calculated on. */
  @Column({ type: 'integer', name: 'month_days', default: 30 })
  monthDays: number;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    default: PayslipStatus.ISSUED,
  })
  status: PayslipStatus;

  @Index()
  @Column({ type: 'integer', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'journal_entry_number',
    nullable: true,
  })
  journalEntryNumber: string | null;

  @Index()
  @Column({ type: 'timestamp', name: 'issued_at' })
  issuedAt: Date;

  @Index()
  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
