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
import { EmployeeEntity } from './employee.entity';

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
@Unique('UQ_hr_payslips_employee_period', [
  'employeeId',
  'periodYear',
  'periodMonth',
])
export class PayslipEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
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
