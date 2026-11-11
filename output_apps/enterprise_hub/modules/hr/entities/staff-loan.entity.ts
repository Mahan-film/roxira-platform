import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { LoanStatus } from '../enums/hr.enum';
import { numericTransformer } from './numeric-column.transformer';
import { EmployeeEntity } from './employee.entity';

/**
 * وام و مساعده پرسنلی (Staff Loan / Advance).
 *
 * اقساط ماهانه این وام در هنگام محاسبه فیش حقوقی به‌صورت خودکار در سرفصل
 * سایر کسورات (otherDeductions) کسر شده و پس از ثبت نهایی حقوق، مانده وام به‌روز می‌شود.
 */
@Entity({ name: 'hr_staff_loans' })
@Unique('UQ_hr_staff_loans_tenant_number', ['tenantId', 'loanNumber'])
@Index('IDX_hr_staff_loans_tenant_employee', ['tenantId', 'employeeId'])
@Index('IDX_hr_staff_loans_tenant_status', ['tenantId', 'status'])
export class StaffLoanEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee?: EmployeeEntity;

  @Column({ type: 'varchar', length: 64, name: 'loan_number' })
  loanNumber: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  /** اصل مبلغ وام به ریال */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'principal_amount',
    transformer: numericTransformer,
  })
  principalAmount: number;

  /** مبلغ هر قسط به ریال */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'instalment_amount',
    transformer: numericTransformer,
  })
  instalmentAmount: number;

  /** کل تعداد اقساط */
  @Column({ type: 'integer', name: 'total_instalments' })
  totalInstalments: number;

  /** تعداد اقساط پرداخت‌شده */
  @Column({ type: 'integer', name: 'paid_instalments', default: 0 })
  paidInstalments: number;

  /** مانده کل وام به ریال */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'remaining_amount',
    transformer: numericTransformer,
  })
  remainingAmount: number;

  @Column({
    type: 'varchar',
    length: 32,
    default: LoanStatus.ACTIVE,
  })
  status: LoanStatus;

  /** تاریخ شروع کسر اقساط */
  @Column({ type: 'varchar', length: 16, name: 'start_date', nullable: true })
  startDate: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
