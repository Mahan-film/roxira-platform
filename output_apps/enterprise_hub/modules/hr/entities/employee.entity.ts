import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EmployeeStatus, Gender, MaritalStatus } from '../enums/hr.enum';
import { EmploymentContractEntity } from './employment-contract.entity';
import { PayslipEntity } from './payslip.entity';

/**
 * پرونده کارمند (Employee Master Record).
 *
 * نگاشت مستقیم به جدول `hr_employees`. هر کارمند دارای کد پرسنلی و کد ملی
 * یکتا است؛ احکام حقوقی (Contract) و فیش‌های حقوقی (Payslip) از طریق روابط
 * OneToMany به این موجودیت متصل می‌شوند.
 *
 * تنها از طریق HrRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'hr_employees' })
export class EmployeeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'employee_number' })
  employeeNumber: string;

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'first_name' })
  firstName: string;

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'last_name' })
  lastName: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20, name: 'national_id' })
  nationalId: string;

  @Column({ type: 'varchar', length: 64, name: 'father_name', nullable: true })
  fatherName: string | null;

  @Column({ type: 'date', name: 'birth_date', nullable: true })
  birthDate: string | null;

  @Column({ type: 'varchar', length: 10, default: Gender.MALE })
  gender: Gender;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  mobile: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  email: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120, name: 'job_title' })
  jobTitle: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  department: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'marital_status',
    default: MaritalStatus.SINGLE,
  })
  maritalStatus: MaritalStatus;

  /** تعداد فرزندان مشمول حق اولاد */
  @Column({ type: 'integer', default: 0 })
  dependants: number;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    name: 'employee_status',
    default: EmployeeStatus.ACTIVE,
  })
  status: EmployeeStatus;

  @Index()
  @Column({ type: 'date', name: 'hire_date' })
  hireDate: string;

  @Column({ type: 'date', name: 'termination_date', nullable: true })
  terminationDate: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'bank_account_number',
    nullable: true,
  })
  bankAccountNumber: string | null;

  @Index()
  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => EmploymentContractEntity, (contract) => contract.employee)
  contracts: EmploymentContractEntity[];

  @OneToMany(() => PayslipEntity, (payslip) => payslip.employee)
  payslips: PayslipEntity[];
}
