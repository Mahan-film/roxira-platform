import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  ContractStatus,
  ContractType,
} from '../enums/hr.enum';
import { numericTransformer } from './numeric-column.transformer';
import { EmployeeEntity } from './employee.entity';

/**
 * حکم/قرارداد حقوقی کارمند (Employment Contract).
 *
 * نگاشت مستقیم به جدول `hr_employment_contracts`. هر قرارداد اجزای حقوق
 * (حقوق پایه، حق مسکن، بن خواربار، حق اولاد) و نرخ بیمه سهم کارگر را نگه
 * می‌دارد و مبنای محاسبه فیش حقوقی ماهانه است.
 *
 * تنها از طریق HrRepository قابل دسترسی است.
 */
@Entity({ name: 'hr_employment_contracts' })
export class EmploymentContractEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'contract_number' })
  contractNumber: string;

  @Index()
  @Column({ type: 'integer', name: 'employee_id' })
  employeeId: number;

  @ManyToOne(() => EmployeeEntity, (employee) => employee.contracts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'employee_id' })
  employee: EmployeeEntity;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    name: 'contract_type',
    default: ContractType.PERMANENT,
  })
  contractType: ContractType;

  @Index()
  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120, name: 'job_title' })
  jobTitle: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  department: string;

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

  /** نرخ بیمه سهم کارگر (کسر اعشاری؛ پیش‌فرض ۰٫۰۷) */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 3,
    name: 'insurance_rate',
    default: 0.07,
    transformer: numericTransformer,
  })
  insuranceRate: number;

  /** مشمول کسر بیمه تأمین اجتماعی */
  @Column({ type: 'boolean', name: 'is_insurance_subject', default: true })
  isInsuranceSubject: boolean;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    default: ContractStatus.ACTIVE,
  })
  status: ContractStatus;

  @Column({ type: 'text', nullable: true })
  description: string | null;

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
