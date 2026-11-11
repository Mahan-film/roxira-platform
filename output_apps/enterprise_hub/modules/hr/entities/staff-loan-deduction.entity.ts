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
import { numericTransformer } from './numeric-column.transformer';
import { EmployeeEntity } from './employee.entity';
import { PayrollRunEntity } from './payroll-run.entity';
import { StaffLoanEntity } from './staff-loan.entity';

/**
 * کسر اقساط وام پرسنلی در اجرای حقوق (Staff Loan Deduction per Payroll Run).
 *
 * مشخص می‌کند در کدام اجرای حقوق (payrollRunId) و برای کدام کارمند و کدام وام
 * چه مبلغی در فیش حقوقی کسر شده است تا مانده وام پس از ثبت نهایی دقیقا منطبق
 * بر فیش‌های حقوقی کسر گردد (LESSONS 18).
 */
@Entity({ name: 'hr_staff_loan_deductions' })
@Unique('UQ_hr_staff_loan_deductions_run_loan', [
  'tenantId',
  'payrollRunId',
  'loanId',
])
@Index('IDX_hr_staff_loan_deductions_tenant_loan', ['tenantId', 'loanId'])
@Index('IDX_hr_staff_loan_deductions_tenant_run', ['tenantId', 'payrollRunId'])
export class StaffLoanDeductionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'loan_id' })
  loanId: number;

  @ManyToOne(() => StaffLoanEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'loan_id' })
  loan?: StaffLoanEntity;

  @Column({ type: 'integer', name: 'payroll_run_id' })
  payrollRunId: number;

  @ManyToOne(() => PayrollRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payroll_run_id' })
  payrollRun?: PayrollRunEntity;

  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee?: EmployeeEntity;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'integer', name: 'period_year' })
  periodYear: number;

  @Column({ type: 'integer', name: 'period_month' })
  periodMonth: number;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status: string;

  @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
