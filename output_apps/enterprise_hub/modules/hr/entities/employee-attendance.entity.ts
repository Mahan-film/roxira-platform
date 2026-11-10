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

/**
 * کارکرد و حضور و غیاب ماهانه پرسنل (Monthly Attendance / Timesheet).
 *
 * اطلاعات کارکرد (روزهای کاری، ساعات اضافه‌کاری، شب‌کاری، تعطیل‌کاری و غیبت/مرخصی بدون حقوق)
 * را نگهداری کرده و به‌صورت خودکار به موتور محاسبه حقوق و دستمزد (PayrollRunService) تزریق می‌شود.
 */
@Entity({ name: 'hr_attendances' })
@Unique('UQ_hr_attendances_tenant_employee_period', [
  'tenantId',
  'employeeId',
  'periodYear',
  'periodMonth',
])
@Index('IDX_hr_attendances_tenant_period', ['tenantId', 'periodYear', 'periodMonth'])
export class EmployeeAttendanceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک رکورد (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Index()
  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee?: EmployeeEntity;

  @Column({ type: 'integer', name: 'period_year' })
  periodYear: number;

  @Column({ type: 'integer', name: 'period_month' })
  periodMonth: number;

  /** روزهای کارکرد موثر در ماه (پیش‌فرض ۳۰ روز یا روزهای ماه) */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'work_days',
    default: 30,
    transformer: numericTransformer,
  })
  workDays: number;

  /** ساعات اضافه‌کاری ماه */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'overtime_hours',
    default: 0,
    transformer: numericTransformer,
  })
  overtimeHours: number;

  /** ساعات شب‌کاری ماه (با ضریب ۳۵٪) */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'night_hours',
    default: 0,
    transformer: numericTransformer,
  })
  nightHours: number;

  /** ساعات تعطیل‌کاری یا جمعه‌کاری ماه (با ضریب ۴۰٪) */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'holiday_hours',
    default: 0,
    transformer: numericTransformer,
  })
  holidayHours: number;

  /** روزهای غیبت غیرموجه */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'absence_days',
    default: 0,
    transformer: numericTransformer,
  })
  absenceDays: number;

  /** روزهای مرخصی بدون حقوق */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'unpaid_leave_days',
    default: 0,
    transformer: numericTransformer,
  })
  unpaidLeaveDays: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
