import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttendanceEventKind, AttendanceEventSource } from '../enums/attendance-event.enum';
import { EmployeeEntity } from './employee.entity';

/**
 * رخداد ثبت تردد روزانه پرسنل (Clock In / Out & Biometric Event).
 *
 * هر رکورد ثبت‌کننده یک ورود یا خروج مستقل است که از طریق ثبت دستی،
 * پین‌پد پایانه فروشگاهی (POS PIN) یا بارگذاری لاگ دستگاه بیومتریک (ZKTeco) ثبت می‌شود.
 */
@Entity({ name: 'attendance_events' })
@Index('IDX_attendance_events_tenant_occurred', ['tenantId', 'occurredAt'])
@Index('IDX_attendance_events_tenant_emp_occurred', ['tenantId', 'employeeId', 'occurredAt'])
@Index('IDX_attendance_events_tenant_branch', ['tenantId', 'branchId', 'occurredAt'])
export class AttendanceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** شناسه سازمان مالک رکورد (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee?: EmployeeEntity;

  @Column({ type: 'integer', name: 'branch_id', nullable: true })
  branchId: number | null;

  @Column({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt: Date;

  @Column({ type: 'varchar', length: 16 })
  kind: AttendanceEventKind;

  @Column({ type: 'varchar', length: 32 })
  source: AttendanceEventSource;

  @Column({ type: 'varchar', length: 64, name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
