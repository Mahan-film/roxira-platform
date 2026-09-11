import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindManyOptions,
  FindOptionsWhere,
  ILike,
  Repository,
} from 'typeorm';
import { ContractStatus, EmployeeStatus } from '../enums/hr.enum';
import { EmployeeEntity } from '../entities/employee.entity';
import { EmploymentContractEntity } from '../entities/employment-contract.entity';
import { PayslipEntity } from '../entities/payslip.entity';

/**
 * سطر تجمیع حقوق قراردادهای فعال (خروجی Query Builder).
 */
export interface ActiveContractAggregate {
  count: string;
  totalBaseSalary: string;
}

/**
 * سطر تجمیع فیش‌های حقوقی (خروجی Query Builder).
 */
export interface PayslipAggregate {
  count: string;
  totalGrossPay: string;
  totalNetPay: string;
  totalInsurance: string;
  totalTax: string;
  totalOtherDeductions: string;
}

/**
 * لایه Repository — تنها نقطه دسترسی به جداول منابع انسانی برای ماژول HR.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته
 * باشند (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class HrRepository {
  constructor(
    @InjectRepository(EmployeeEntity)
    private readonly employees: Repository<EmployeeEntity>,
    @InjectRepository(EmploymentContractEntity)
    private readonly contracts: Repository<EmploymentContractEntity>,
    @InjectRepository(PayslipEntity)
    private readonly payslips: Repository<PayslipEntity>,
  ) {}

  // ---------------------------------------------------------------------------
  // کارمندان (Employees)
  // ---------------------------------------------------------------------------

  async countEmployees(): Promise<number> {
    return this.employees.count();
  }

  async createEmployee(data: Partial<EmployeeEntity>): Promise<EmployeeEntity> {
    const entity = this.employees.create(data);
    return this.employees.save(entity);
  }

  async saveEmployee(entity: EmployeeEntity): Promise<EmployeeEntity> {
    return this.employees.save(entity);
  }

  async findEmployeeById(id: number): Promise<EmployeeEntity | null> {
    return this.employees.findOne({ where: { id } });
  }

  async findEmployeeByNationalId(
    nationalId: string,
  ): Promise<EmployeeEntity | null> {
    return this.employees.findOne({ where: { nationalId } });
  }

  async findEmployeeByNumber(
    employeeNumber: string,
  ): Promise<EmployeeEntity | null> {
    return this.employees.findOne({ where: { employeeNumber } });
  }

  async findAndCountEmployees(
    options: FindManyOptions<EmployeeEntity>,
  ): Promise<[EmployeeEntity[], number]> {
    return this.employees.findAndCount(options);
  }

  // ---------------------------------------------------------------------------
  // قراردادهای حقوقی (Employment Contracts)
  // ---------------------------------------------------------------------------

  async createContract(
    data: Partial<EmploymentContractEntity>,
  ): Promise<EmploymentContractEntity> {
    const entity = this.contracts.create(data);
    return this.contracts.save(entity);
  }

  async findContractById(id: number): Promise<EmploymentContractEntity | null> {
    return this.contracts.findOne({
      where: { id },
      relations: { employee: true },
    });
  }

  async findContractByNumber(
    contractNumber: string,
  ): Promise<EmploymentContractEntity | null> {
    return this.contracts.findOne({ where: { contractNumber } });
  }

  /**
   * آخرین قرارداد فعال کارمند (بر اساس تاریخ شروع نزولی).
   */
  async findActiveContractByEmployee(
    employeeId: number,
  ): Promise<EmploymentContractEntity | null> {
    return this.contracts.findOne({
      where: { employeeId, status: ContractStatus.ACTIVE },
      relations: { employee: true },
      order: { startDate: 'DESC', id: 'DESC' },
    });
  }

  async findAndCountContracts(
    options: FindManyOptions<EmploymentContractEntity>,
  ): Promise<[EmploymentContractEntity[], number]> {
    return this.contracts.findAndCount(options);
  }

  async countActiveContracts(): Promise<number> {
    return this.contracts.count({
      where: { status: ContractStatus.ACTIVE },
    });
  }

  async countEmployeesByStatus(status: EmployeeStatus): Promise<number> {
    return this.employees.count({ where: { status } });
  }

  /**
   * تجمیع جمع حقوق پایه قراردادهای فعال.
   */
  async aggregateActiveContracts(): Promise<ActiveContractAggregate> {
    const raw = await this.contracts
      .createQueryBuilder('contract')
      .select('COUNT(contract.id)', 'count')
      .addSelect('COALESCE(SUM(contract.baseSalary), 0)', 'totalBaseSalary')
      .where('contract.status = :status', { status: ContractStatus.ACTIVE })
      .getRawOne<ActiveContractAggregate>();
    return raw ?? { count: '0', totalBaseSalary: '0' };
  }

  // ---------------------------------------------------------------------------
  // فیش‌های حقوقی (Payslips)
  // ---------------------------------------------------------------------------

  async createPayslip(
    data: Partial<PayslipEntity>,
  ): Promise<PayslipEntity> {
    const entity = this.payslips.create(data);
    return this.payslips.save(entity);
  }

  async findPayslipById(id: number): Promise<PayslipEntity | null> {
    return this.payslips.findOne({
      where: { id },
      relations: { employee: true },
    });
  }

  async findPayslipByPeriod(
    employeeId: number,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayslipEntity | null> {
    return this.payslips.findOne({
      where: { employeeId, periodYear, periodMonth },
    });
  }

  async findAndCountPayslips(
    options: FindManyOptions<PayslipEntity>,
  ): Promise<[PayslipEntity[], number]> {
    return this.payslips.findAndCount(options);
  }

  async savePayslip(entity: PayslipEntity): Promise<PayslipEntity> {
    return this.payslips.save(entity);
  }

  /**
   * تجمیع تحلیلی فیش‌های حقوقی برای کارت‌های بنتو.
   */
  async aggregatePayslips(): Promise<PayslipAggregate> {
    const raw = await this.payslips
      .createQueryBuilder('payslip')
      .select('COUNT(payslip.id)', 'count')
      .addSelect('COALESCE(SUM(payslip.grossPay), 0)', 'totalGrossPay')
      .addSelect('COALESCE(SUM(payslip.netPay), 0)', 'totalNetPay')
      .addSelect(
        'COALESCE(SUM(payslip.insuranceDeduction), 0)',
        'totalInsurance',
      )
      .addSelect('COALESCE(SUM(payslip.incomeTax), 0)', 'totalTax')
      .addSelect(
        'COALESCE(SUM(payslip.otherDeductions), 0)',
        'totalOtherDeductions',
      )
      .getRawOne<PayslipAggregate>();
    return (
      raw ?? {
        count: '0',
        totalGrossPay: '0',
        totalNetPay: '0',
        totalInsurance: '0',
        totalTax: '0',
        totalOtherDeductions: '0',
      }
    );
  }

  /** ساخت شرط جست‌وجوی کارمند بر اساس نام/کد پرسنلی/کد ملی */
  static buildEmployeeSearchWhere(
    search: string,
  ): FindOptionsWhere<EmployeeEntity>[] {
    const term = `%${search}%`;
    return [
      { firstName: ILike(term) },
      { lastName: ILike(term) },
      { employeeNumber: ILike(term) },
      { nationalId: ILike(term) },
    ];
  }
}
