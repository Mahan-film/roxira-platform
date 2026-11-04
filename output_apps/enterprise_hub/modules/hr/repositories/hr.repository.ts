import { Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  DataSource,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
  ILike,
  In,
  LessThan,
  Repository,
} from 'typeorm';
import {
  ContractStatus,
  EmployeeStatus,
  PayslipStatus,
} from '../enums/hr.enum';
import { ContractAllowanceEntity } from '../entities/contract-allowance.entity';
import { EmployeeEntity } from '../entities/employee.entity';
import { EmploymentContractEntity } from '../entities/employment-contract.entity';
import { PayrollRunEntity } from '../entities/payroll-run.entity';
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

interface HrRepos {
  employees: Repository<EmployeeEntity>;
  contracts: Repository<EmploymentContractEntity>;
  payslips: Repository<PayslipEntity>;
  payrollRuns: Repository<PayrollRunEntity>;
  allowances: Repository<ContractAllowanceEntity>;
}

/**
 * لایه Repository — تنها نقطه دسترسی به جداول منابع انسانی برای ماژول HR.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته
 * باشند (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class HrRepository {
  constructor(
    private readonly scope: TenantScope,
    private readonly dataSource: DataSource,
  ) {}

  /** Runs `work` in one database transaction (commit on success, rollback on throw). */
  async runInTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(work);
  }

  /**
   * Every HR table has FORCE row-level security: each call binds `app.tenant_id` on its transaction
   * (or on the caller's, when a manager is passed) and every query still filters by tenant itself.
   */
  private use<T>(
    tenantId: string,
    manager: EntityManager | undefined,
    fn: (r: HrRepos) => Promise<T>,
  ): Promise<T> {
    return this.scope.within(tenantId, manager, (m) =>
      fn({
        employees: m.getRepository(EmployeeEntity),
        contracts: m.getRepository(EmploymentContractEntity),
        payslips: m.getRepository(PayslipEntity),
        payrollRuns: m.getRepository(PayrollRunEntity),
        allowances: m.getRepository(ContractAllowanceEntity),
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // کارمندان (Employees)
  // ---------------------------------------------------------------------------

  async countEmployees(tenantId: string): Promise<number> {
    return this.use(tenantId, undefined, async (r) => {
      return r.employees.count({ where: { tenantId } });
    });
  }

  async createEmployee(
    tenantId: string,
    data: Partial<EmployeeEntity>,
  ): Promise<EmployeeEntity> {
    return this.use(tenantId, undefined, async (r) => {
      const entity = r.employees.create({ ...data, tenantId });
      return r.employees.save(entity);
    });
  }

  async saveEmployee(
    tenantId: string,
    entity: EmployeeEntity,
  ): Promise<EmployeeEntity> {
    return this.use(tenantId, undefined, async (r) => {
      // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
      await r.employees.update(
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
          insuranceNumber: entity.insuranceNumber,
          updatedAt: entity.updatedAt,
        },
      );
      entity.tenantId = tenantId;
      return entity;
    });
  }

  async findEmployeeById(
    tenantId: string,
    id: number,
  ): Promise<EmployeeEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.employees.findOne({ where: { id, tenantId } });
    });
  }

  async findEmployeeByNationalId(
    tenantId: string,
    nationalId: string,
  ): Promise<EmployeeEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.employees.findOne({ where: { nationalId, tenantId } });
    });
  }

  async findEmployeeByNumber(
    tenantId: string,
    employeeNumber: string,
  ): Promise<EmployeeEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.employees.findOne({ where: { employeeNumber, tenantId } });
    });
  }

  /** کدهای ملی موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findEmployeeNationalIds(
    tenantId: string,
    nationalIds: string[],
  ): Promise<string[]> {
    return this.use(tenantId, undefined, async (r) => {
      if (nationalIds.length === 0) {
        return [];
      }
      const rows = await r.employees.find({
        where: { tenantId, nationalId: In(nationalIds) },
        select: { nationalId: true },
      });
      return rows.map((row) => row.nationalId);
    });
  }

  /** شناسه کارمندانی که قرارداد یا فیش حقوقی دارند (ارجاع‌شده؛ undo ممنوع). */
  async findReferencedEmployeeIds(
    tenantId: string,
    ids: number[],
  ): Promise<number[]> {
    return this.use(tenantId, undefined, async (r) => {
      if (ids.length === 0) {
        return [];
      }
      const [contracts, payslips] = await Promise.all([
        r.contracts.find({
          where: { tenantId, employeeId: In(ids) },
          select: { employeeId: true },
        }),
        r.payslips.find({
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
    });
  }

  /** حذف کارمندان یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteEmployeesByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    return this.use(tenantId, undefined, async (r) => {
      if (ids.length === 0) {
        return 0;
      }
      const result = await r.employees.delete({ tenantId, id: In(ids) });
      return result.affected ?? 0;
    });
  }

  async findAndCountEmployees(
    tenantId: string,
    options: FindManyOptions<EmployeeEntity>,
  ): Promise<[EmployeeEntity[], number]> {
    return this.use(tenantId, undefined, async (r) => {
      const { where, ...rest } = options;
      const scoped: FindOptionsWhere<EmployeeEntity> | FindOptionsWhere<EmployeeEntity>[] =
        Array.isArray(where)
          ? where.map((condition) => ({ ...condition, tenantId }))
          : { ...(where ?? {}), tenantId };
      return r.employees.findAndCount({ ...rest, where: scoped });
    });
  }

  // ---------------------------------------------------------------------------
  // قراردادهای حقوقی (Employment Contracts)
  // ---------------------------------------------------------------------------

  async createContract(
    tenantId: string,
    data: Partial<EmploymentContractEntity>,
  ): Promise<EmploymentContractEntity> {
    return this.use(tenantId, undefined, async (r) => {
      const entity = r.contracts.create({ ...data, tenantId });
      return r.contracts.save(entity);
    });
  }

  async findContractById(
    tenantId: string,
    id: number,
  ): Promise<EmploymentContractEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.contracts.findOne({
        where: { id, tenantId },
        relations: { employee: true },
      });
    });
  }

  async findContractByNumber(
    tenantId: string,
    contractNumber: string,
  ): Promise<EmploymentContractEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.contracts.findOne({ where: { contractNumber, tenantId } });
    });
  }

  /**
   * آخرین قرارداد فعال کارمند (بر اساس تاریخ شروع نزولی).
   */
  async findActiveContractByEmployee(
    tenantId: string,
    employeeId: number,
  ): Promise<EmploymentContractEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.contracts.findOne({
        where: { employeeId, status: ContractStatus.ACTIVE, tenantId },
        relations: { employee: true },
        order: { startDate: 'DESC', id: 'DESC' },
      });
    });
  }

  async findAndCountContracts(
    tenantId: string,
    options: FindManyOptions<EmploymentContractEntity>,
  ): Promise<[EmploymentContractEntity[], number]> {
    return this.use(tenantId, undefined, async (r) => {
      const { where, ...rest } = options;
      const scoped:
        | FindOptionsWhere<EmploymentContractEntity>
        | FindOptionsWhere<EmploymentContractEntity>[] = Array.isArray(where)
        ? where.map((condition) => ({ ...condition, tenantId }))
        : { ...(where ?? {}), tenantId };
      return r.contracts.findAndCount({ ...rest, where: scoped });
    });
  }

  async countActiveContracts(tenantId: string): Promise<number> {
    return this.use(tenantId, undefined, async (r) => {
      return r.contracts.count({
        where: { status: ContractStatus.ACTIVE, tenantId },
      });
    });
  }

  async countEmployeesByStatus(
    tenantId: string,
    status: EmployeeStatus,
  ): Promise<number> {
    return this.use(tenantId, undefined, async (r) => {
      return r.employees.count({ where: { status, tenantId } });
    });
  }

  /**
   * تجمیع جمع حقوق پایه قراردادهای فعال.
   */
  async aggregateActiveContracts(
    tenantId: string,
  ): Promise<ActiveContractAggregate> {
    return this.use(tenantId, undefined, async (r) => {
      const raw = await r.contracts
        .createQueryBuilder('contract')
        .select('COUNT(contract.id)', 'count')
        .addSelect('COALESCE(SUM(contract.baseSalary), 0)', 'totalBaseSalary')
        .where('contract.status = :status', { status: ContractStatus.ACTIVE })
        .andWhere('contract.tenantId = :tenantId', { tenantId })
        .getRawOne<ActiveContractAggregate>();
      return raw ?? { count: '0', totalBaseSalary: '0' };
    });
  }

  // ---------------------------------------------------------------------------
  // فیش‌های حقوقی (Payslips)
  // ---------------------------------------------------------------------------

  async createPayslip(
    tenantId: string,
    data: Partial<PayslipEntity>,
  ): Promise<PayslipEntity> {
    return this.use(tenantId, undefined, async (r) => {
      const entity = r.payslips.create({ ...data, tenantId });
      return r.payslips.save(entity);
    });
  }

  async findPayslipById(
    tenantId: string,
    id: number,
  ): Promise<PayslipEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.payslips.findOne({
        where: { id, tenantId },
        relations: { employee: true },
      });
    });
  }

  async findPayslipByPeriod(
    tenantId: string,
    employeeId: number,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayslipEntity | null> {
    return this.use(tenantId, undefined, async (r) => {
      return r.payslips.findOne({
        where: { employeeId, periodYear, periodMonth, tenantId },
      });
    });
  }

  async findAndCountPayslips(
    tenantId: string,
    options: FindManyOptions<PayslipEntity>,
  ): Promise<[PayslipEntity[], number]> {
    return this.use(tenantId, undefined, async (r) => {
      const { where, ...rest } = options;
      const scoped: FindOptionsWhere<PayslipEntity> | FindOptionsWhere<PayslipEntity>[] =
        Array.isArray(where)
          ? where.map((condition) => ({ ...condition, tenantId }))
          : { ...(where ?? {}), tenantId };
      return r.payslips.findAndCount({ ...rest, where: scoped });
    });
  }

  async savePayslip(
    tenantId: string,
    entity: PayslipEntity,
  ): Promise<PayslipEntity> {
    return this.use(tenantId, undefined, async (r) => {
      // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
      await r.payslips.update(
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
    });
  }

  /**
   * تجمیع تحلیلی فیش‌های حقوقی برای کارت‌های بنتو.
   */
  async aggregatePayslips(tenantId: string): Promise<PayslipAggregate> {
    return this.use(tenantId, undefined, async (r) => {
      const raw = await r.payslips
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
    });
  }

  // ---------------------------------------------------------------------------
  // Payroll runs (every query is scoped by tenantId)
  // ---------------------------------------------------------------------------

  /** Active employees of the tenant (payroll-run population). */
  async findActiveEmployees(tenantId: string): Promise<EmployeeEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      return r.employees.find({
        where: { tenantId, status: EmployeeStatus.ACTIVE },
        order: { id: 'ASC' },
      });
    });
  }

  /** Active contracts of the given employees, newest first. */
  async findActiveContractsByEmployeeIds(
    tenantId: string,
    employeeIds: number[],
  ): Promise<EmploymentContractEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      if (employeeIds.length === 0) {
        return [];
      }
      return r.contracts.find({
        where: {
          tenantId,
          status: ContractStatus.ACTIVE,
          employeeId: In(employeeIds),
        },
        order: { startDate: 'DESC', id: 'DESC' },
      });
    });
  }

  /** Allowances of the given contracts. */
  async findAllowancesByContractIds(
    tenantId: string,
    contractIds: number[],
  ): Promise<ContractAllowanceEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      if (contractIds.length === 0) {
        return [];
      }
      return r.allowances.find({
        where: { tenantId, contractId: In(contractIds) },
        order: { id: 'ASC' },
      });
    });
  }

  /** Replace a contract's allowances in one transaction. */
  async replaceAllowances(
    tenantId: string,
    contractId: number,
    rows: Partial<ContractAllowanceEntity>[],
  ): Promise<ContractAllowanceEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      await r.allowances.delete({ tenantId, contractId });
      return r.allowances.save(
        rows.map((row) =>
          r.allowances.create({ ...row, tenantId, contractId }),
        ),
      );
    });
  }

  /** Issued payslips of the given employees in a year before `beforeMonth` (for cumulative tax). */
  async findIssuedPayslipsBefore(
    tenantId: string,
    employeeIds: number[],
    periodYear: number,
    beforeMonth: number,
  ): Promise<PayslipEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      if (employeeIds.length === 0) {
        return [];
      }
      return r.payslips.find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          periodYear,
          periodMonth: LessThan(beforeMonth),
          status: In([PayslipStatus.ISSUED, PayslipStatus.PAID]),
        },
      });
    });
  }

  /** All runs of a Jalali year. */
  async findPayrollRunsOfYear(
    tenantId: string,
    periodYear: number,
    manager?: EntityManager,
  ): Promise<PayrollRunEntity[]> {
    return this.use(tenantId, manager, async (r) => {
      return r.payrollRuns.find({ where: { tenantId, periodYear } });
    });
  }

  /** All payslips of a period (run payslips and legacy single payslips). */
  async findPayslipsOfPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayslipEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      return r.payslips.find({
        where: { tenantId, periodYear, periodMonth },
      });
    });
  }

  async findPayrollRunById(
    tenantId: string,
    id: number,
    manager?: EntityManager,
  ): Promise<PayrollRunEntity | null> {
    return this.use(tenantId, manager, async (r) => {
      return r.payrollRuns.findOne({ where: { id, tenantId } });
    });
  }

  async findPayrollRunByPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
    manager?: EntityManager,
  ): Promise<PayrollRunEntity | null> {
    return this.use(tenantId, manager, async (r) => {
      return r.payrollRuns.findOne({
        where: { tenantId, periodYear, periodMonth },
      });
    });
  }

  async listPayrollRuns(tenantId: string): Promise<PayrollRunEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      return r.payrollRuns.find({
        where: { tenantId },
        order: { periodYear: 'DESC', periodMonth: 'DESC' },
        take: 120,
      });
    });
  }

  async createPayrollRun(
    tenantId: string,
    data: Partial<PayrollRunEntity>,
    manager?: EntityManager,
  ): Promise<PayrollRunEntity> {
    return this.use(tenantId, manager, async (r) => {
      const repo = r.payrollRuns;
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async savePayrollRun(
    tenantId: string,
    entity: PayrollRunEntity,
    manager?: EntityManager,
  ): Promise<PayrollRunEntity> {
    return this.use(tenantId, manager, async (r) => {
      // Tenant-scoped update: another tenant's id changes 0 rows.
      await r.payrollRuns.update(
        { id: entity.id, tenantId },
        {
          status: entity.status,
          ratesYear: entity.ratesYear,
          employeeCount: entity.employeeCount,
          totalGross: entity.totalGross,
          totalInsurable: entity.totalInsurable,
          totalEmployeeInsurance: entity.totalEmployeeInsurance,
          totalEmployerInsurance: entity.totalEmployerInsurance,
          totalUnemploymentInsurance: entity.totalUnemploymentInsurance,
          totalIncomeTax: entity.totalIncomeTax,
          totalOtherDeductions: entity.totalOtherDeductions,
          totalNet: entity.totalNet,
          journalEntryId: entity.journalEntryId,
          journalEntryNumber: entity.journalEntryNumber,
          postedAt: entity.postedAt,
          updatedAt: entity.updatedAt,
        },
      );
      entity.tenantId = tenantId;
      return entity;
    });
  }

  async findPayslipsByRun(
    tenantId: string,
    payrollRunId: number,
  ): Promise<PayslipEntity[]> {
    return this.use(tenantId, undefined, async (r) => {
      return r.payslips.find({
        where: { tenantId, payrollRunId },
        relations: { employee: true },
        order: { employeeId: 'ASC' },
      });
    });
  }

  async createPayslips(
    tenantId: string,
    rows: Partial<PayslipEntity>[],
    manager?: EntityManager,
  ): Promise<PayslipEntity[]> {
    return this.use(tenantId, manager, async (r) => {
      if (rows.length === 0) {
        return [];
      }
      const repo = r.payslips;
      const entities = rows.map((row) => repo.create({ ...row, tenantId }));
      return repo.save(entities);
    });
  }

  /** Remove the payslips of a DRAFT run before recalculating it. */
  async deletePayslipsByRun(
    tenantId: string,
    payrollRunId: number,
    manager?: EntityManager,
  ): Promise<number> {
    return this.use(tenantId, manager, async (r) => {
      const result = await r.payslips.delete({ tenantId, payrollRunId });
      return result.affected ?? 0;
    });
  }

  /** Mark all payslips of a run with a status and journal entry. */
  async markRunPayslips(
    tenantId: string,
    payrollRunId: number,
    changes: Pick<
      PayslipEntity,
      'status' | 'journalEntryId' | 'journalEntryNumber' | 'issuedAt'
    >,
    manager?: EntityManager,
  ): Promise<void> {
    return this.use(tenantId, manager, async (r) => {
      await r.payslips.update(
        { tenantId, payrollRunId },
        { ...changes, updatedAt: new Date() },
      );
    });
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
