import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindManyOptions,
  FindOptionsWhere,
  ILike,
  In,
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

  async countEmployees(tenantId: string): Promise<number> {
    return this.employees.count({ where: { tenantId } });
  }

  async createEmployee(
    tenantId: string,
    data: Partial<EmployeeEntity>,
  ): Promise<EmployeeEntity> {
    const entity = this.employees.create({ ...data, tenantId });
    return this.employees.save(entity);
  }

  async saveEmployee(
    tenantId: string,
    entity: EmployeeEntity,
  ): Promise<EmployeeEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.employees.update(
      { id: entity.id, tenantId },
      {
        employeeNumber: entity.employeeNumber,
        firstName: entity.firstName,
        lastName: entity.lastName,
        nationalId: entity.nationalId,
        fatherName: entity.fatherName,
        birthDate: entity.birthDate,
        gender: entity.gender,
        mobile: entity.mobile,
        email: entity.email,
        jobTitle: entity.jobTitle,
        department: entity.department,
        maritalStatus: entity.maritalStatus,
        dependants: entity.dependants,
        status: entity.status,
        hireDate: entity.hireDate,
        terminationDate: entity.terminationDate,
        bankAccountNumber: entity.bankAccountNumber,
        updatedAt: entity.updatedAt,
      },
    );
    entity.tenantId = tenantId;
    return entity;
  }

  async findEmployeeById(
    tenantId: string,
    id: number,
  ): Promise<EmployeeEntity | null> {
    return this.employees.findOne({ where: { id, tenantId } });
  }

  async findEmployeeByNationalId(
    tenantId: string,
    nationalId: string,
  ): Promise<EmployeeEntity | null> {
    return this.employees.findOne({ where: { nationalId, tenantId } });
  }

  async findEmployeeByNumber(
    tenantId: string,
    employeeNumber: string,
  ): Promise<EmployeeEntity | null> {
    return this.employees.findOne({ where: { employeeNumber, tenantId } });
  }

  /** کدهای ملی موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findEmployeeNationalIds(
    tenantId: string,
    nationalIds: string[],
  ): Promise<string[]> {
    if (nationalIds.length === 0) {
      return [];
    }
    const rows = await this.employees.find({
      where: { tenantId, nationalId: In(nationalIds) },
      select: { nationalId: true },
    });
    return rows.map((row) => row.nationalId);
  }

  /** شناسه کارمندانی که قرارداد یا فیش حقوقی دارند (ارجاع‌شده؛ undo ممنوع). */
  async findReferencedEmployeeIds(
    tenantId: string,
    ids: number[],
  ): Promise<number[]> {
    if (ids.length === 0) {
      return [];
    }
    const [contracts, payslips] = await Promise.all([
      this.contracts.find({
        where: { tenantId, employeeId: In(ids) },
        select: { employeeId: true },
      }),
      this.payslips.find({
        where: { tenantId, employeeId: In(ids) },
        select: { employeeId: true },
      }),
    ]);
    return Array.from(
      new Set([
        ...contracts.map((row) => row.employeeId),
        ...payslips.map((row) => row.employeeId),
      ]),
    );
  }

  /** حذف کارمندان یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteEmployeesByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.employees.delete({ tenantId, id: In(ids) });
    return result.affected ?? 0;
  }

  async findAndCountEmployees(
    tenantId: string,
    options: FindManyOptions<EmployeeEntity>,
  ): Promise<[EmployeeEntity[], number]> {
    const { where, ...rest } = options;
    const scoped: FindOptionsWhere<EmployeeEntity> | FindOptionsWhere<EmployeeEntity>[] =
      Array.isArray(where)
        ? where.map((condition) => ({ ...condition, tenantId }))
        : { ...(where ?? {}), tenantId };
    return this.employees.findAndCount({ ...rest, where: scoped });
  }

  // ---------------------------------------------------------------------------
  // قراردادهای حقوقی (Employment Contracts)
  // ---------------------------------------------------------------------------

  async createContract(
    tenantId: string,
    data: Partial<EmploymentContractEntity>,
  ): Promise<EmploymentContractEntity> {
    const entity = this.contracts.create({ ...data, tenantId });
    return this.contracts.save(entity);
  }

  async findContractById(
    tenantId: string,
    id: number,
  ): Promise<EmploymentContractEntity | null> {
    return this.contracts.findOne({
      where: { id, tenantId },
      relations: { employee: true },
    });
  }

  async findContractByNumber(
    tenantId: string,
    contractNumber: string,
  ): Promise<EmploymentContractEntity | null> {
    return this.contracts.findOne({ where: { contractNumber, tenantId } });
  }

  /**
   * آخرین قرارداد فعال کارمند (بر اساس تاریخ شروع نزولی).
   */
  async findActiveContractByEmployee(
    tenantId: string,
    employeeId: number,
  ): Promise<EmploymentContractEntity | null> {
    return this.contracts.findOne({
      where: { employeeId, status: ContractStatus.ACTIVE, tenantId },
      relations: { employee: true },
      order: { startDate: 'DESC', id: 'DESC' },
    });
  }

  async findAndCountContracts(
    tenantId: string,
    options: FindManyOptions<EmploymentContractEntity>,
  ): Promise<[EmploymentContractEntity[], number]> {
    const { where, ...rest } = options;
    const scoped:
      | FindOptionsWhere<EmploymentContractEntity>
      | FindOptionsWhere<EmploymentContractEntity>[] = Array.isArray(where)
      ? where.map((condition) => ({ ...condition, tenantId }))
      : { ...(where ?? {}), tenantId };
    return this.contracts.findAndCount({ ...rest, where: scoped });
  }

  async countActiveContracts(tenantId: string): Promise<number> {
    return this.contracts.count({
      where: { status: ContractStatus.ACTIVE, tenantId },
    });
  }

  async countEmployeesByStatus(
    tenantId: string,
    status: EmployeeStatus,
  ): Promise<number> {
    return this.employees.count({ where: { status, tenantId } });
  }

  /**
   * تجمیع جمع حقوق پایه قراردادهای فعال.
   */
  async aggregateActiveContracts(
    tenantId: string,
  ): Promise<ActiveContractAggregate> {
    const raw = await this.contracts
      .createQueryBuilder('contract')
      .select('COUNT(contract.id)', 'count')
      .addSelect('COALESCE(SUM(contract.baseSalary), 0)', 'totalBaseSalary')
      .where('contract.status = :status', { status: ContractStatus.ACTIVE })
      .andWhere('contract.tenantId = :tenantId', { tenantId })
      .getRawOne<ActiveContractAggregate>();
    return raw ?? { count: '0', totalBaseSalary: '0' };
  }

  // ---------------------------------------------------------------------------
  // فیش‌های حقوقی (Payslips)
  // ---------------------------------------------------------------------------

  async createPayslip(
    tenantId: string,
    data: Partial<PayslipEntity>,
  ): Promise<PayslipEntity> {
    const entity = this.payslips.create({ ...data, tenantId });
    return this.payslips.save(entity);
  }

  async findPayslipById(
    tenantId: string,
    id: number,
  ): Promise<PayslipEntity | null> {
    return this.payslips.findOne({
      where: { id, tenantId },
      relations: { employee: true },
    });
  }

  async findPayslipByPeriod(
    tenantId: string,
    employeeId: number,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayslipEntity | null> {
    return this.payslips.findOne({
      where: { employeeId, periodYear, periodMonth, tenantId },
    });
  }

  async findAndCountPayslips(
    tenantId: string,
    options: FindManyOptions<PayslipEntity>,
  ): Promise<[PayslipEntity[], number]> {
    const { where, ...rest } = options;
    const scoped: FindOptionsWhere<PayslipEntity> | FindOptionsWhere<PayslipEntity>[] =
      Array.isArray(where)
        ? where.map((condition) => ({ ...condition, tenantId }))
        : { ...(where ?? {}), tenantId };
    return this.payslips.findAndCount({ ...rest, where: scoped });
  }

  async savePayslip(
    tenantId: string,
    entity: PayslipEntity,
  ): Promise<PayslipEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.payslips.update(
      { id: entity.id, tenantId },
      {
        payslipNumber: entity.payslipNumber,
        employeeId: entity.employeeId,
        contractId: entity.contractId,
        periodYear: entity.periodYear,
        periodMonth: entity.periodMonth,
        baseSalary: entity.baseSalary,
        housingAllowance: entity.housingAllowance,
        foodAllowance: entity.foodAllowance,
        childAllowance: entity.childAllowance,
        overtimeAmount: entity.overtimeAmount,
        grossPay: entity.grossPay,
        insuranceDeduction: entity.insuranceDeduction,
        incomeTax: entity.incomeTax,
        otherDeductions: entity.otherDeductions,
        netPay: entity.netPay,
        status: entity.status,
        journalEntryId: entity.journalEntryId,
        journalEntryNumber: entity.journalEntryNumber,
        issuedAt: entity.issuedAt,
        updatedAt: entity.updatedAt,
      },
    );
    entity.tenantId = tenantId;
    return entity;
  }

  /**
   * تجمیع تحلیلی فیش‌های حقوقی برای کارت‌های بنتو.
   */
  async aggregatePayslips(tenantId: string): Promise<PayslipAggregate> {
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
      .where('payslip.tenantId = :tenantId', { tenantId })
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
    tenantId: string,
    search: string,
  ): FindOptionsWhere<EmployeeEntity>[] {
    const term = `%${search}%`;
    return [
      { tenantId, firstName: ILike(term) },
      { tenantId, lastName: ILike(term) },
      { tenantId, employeeNumber: ILike(term) },
      { tenantId, nationalId: ILike(term) },
    ];
  }
}
