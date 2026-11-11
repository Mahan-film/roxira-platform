import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeaveStatus, LeaveType } from '../enums/hr.enum';
import { numericTransformer } from './numeric-column.transformer';
import { EmployeeEntity } from './employee.entity';

/**
 * مرخصی پرسنل (Employee Leave Request & Record).
 *
 * انواع مرخصی طبق قانون کار (استحقاقی، بدون حقوق، استعلاجی، مناسبتی).
 * مرخصی‌های بدون حقوقِ تاییدشده در کارکرد ماهانه و محاسبه حقوق به عنوان کسور غیبت لحاظ می‌شوند.
 */
@Entity({ name: 'hr_leaves' })
@Index('IDX_hr_leaves_tenant_employee', ['tenantId', 'employeeId'])
@Index('IDX_hr_leaves_tenant_status', ['tenantId', 'status'])
@Index('IDX_hr_leaves_tenant_created', ['tenantId', 'createdAt'])
export class EmployeeLeaveEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee?: EmployeeEntity;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'leave_type',
    default: LeaveType.ANNUAL,
  })
  leaveType: LeaveType;

  /** تاریخ شروع به فرمت ISO YYYY-MM-DD یا شمسی YYYY/MM/DD */
  @Column({ type: 'varchar', length: 16, name: 'start_date' })
  startDate: string;

  /** تاریخ پایان */
  @Column({ type: 'varchar', length: 16, name: 'end_date' })
  endDate: string;

  /** تعداد روز مرخصی */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 1,
    transformer: numericTransformer,
  })
  days: number;

  @Column({
    type: 'varchar',
    length: 32,
    default: LeaveStatus.PENDING,
  })
  status: LeaveStatus;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 128, name: 'approved_by', nullable: true })
  approvedBy: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
