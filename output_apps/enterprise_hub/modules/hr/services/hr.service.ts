import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere } from 'typeorm';
import { AccountingService } from '../../accounting/services/accounting.service';
import {
  CONTRACT_NUMBER_PREFIX,
  EMPLOYEE_NUMBER_PREFIX,
  MONEY_SCALE,
  PAYROLL_BANK_ACCOUNT_CODE,
  PAYROLL_EXPENSE_ACCOUNT_CODE,
  PAYROLL_PAYABLE_ACCOUNT_CODE,
  PAYSLIP_NUMBER_PREFIX,
} from '../constants/hr.constants';
import { StatutoryService } from '../statutory/statutory.service';
import {
  ContractResponseDto,
  EmployeeResponseDto,
  HrStatsResponseDto,
  PaginatedEmployeeResponseDto,
  PaginatedPayslipResponseDto,
  PayrollCalculationResponseDto,
  PayslipResponseDto,
} from '../dto/hr-response.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import {
  CalculatePayrollDto,
  IssuePayslipDto,
} from '../dto/payroll.dto';
import { QueryEmployeeDto, QueryPayslipDto } from '../dto/query-hr.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';
import { EmployeeEntity } from '../entities/employee.entity';
import { EmploymentContractEntity } from '../entities/employment-contract.entity';
import { PayslipEntity } from '../entities/payslip.entity';
import {
  ContractStatus,
  EmployeeStatus,
  Gender,
  MaritalStatus,
  PayslipStatus,
  WageTaxRegime,
} from '../enums/hr.enum';
import { HrRepository } from '../repositories/hr.repository';
import { gregorianToJalali, jalaliMonthDays } from './jalali-period';
import { calculateEndOfService } from './end-of-service';
import { PreviewSettlementDto, SettlementPreviewDto } from '../dto/settlement.dto';
import { ContractAllowanceDto, ReplaceAllowancesDto } from '../dto/contract-allowance.dto';
import { PayrollYearToDate, yearToDateOf, calculatePayroll } from './payroll-calculator';

/** ورودی درج کارمند از مسیر ورود داده (فیلدهای اختیاری خالی می‌مانند). */
export interface HrImportEmployeeInput {
  employeeNumber?: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  fatherName?: string;
  birthDate?: string;
  gender?: Gender;
  mobile: string;
  email?: string;
  jobTitle: string;
  department: string;
  maritalStatus?: MaritalStatus;
  dependants?: number;
  hireDate?: string;
  bankAccountNumber?: string;
}

/**
 * منطق کسب‌وکار ماژول منابع انسانی و حقوق و دستمزد.
 *
 * مسئولیت‌ها:
 * - کارگزینی پرسنل و احکام/قراردادهای حقوقی.
 * - محاسبه حقوق (حقوق پایه، بن خواربار، حق مسکن، بیمه ۷٪ سهم کارگر و
 *   مالیات پله‌ای بر حقوق).
 * - صدور فیش حقوقی و ثبت خودکار سند هزینه حقوق در دفتر روزنامه از طریق
 *   `AccountingService` (بدون دسترسی مستقیم به جداول مالی).
 *
 * Controller فقط مسیریابی می‌کند و Repository تنها نقطه پرسیستنس است
 * (Rule #3 - AGENTS.md).
 */
@Injectable()
export class HrService {
  constructor(
    private readonly hrRepository: HrRepository,
    private readonly accountingService: AccountingService,
    private readonly statutory: StatutoryService,
  ) {}

  private round(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private toIso(value: Date | string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }

  private pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
  }

  // ---------------------------------------------------------------------------
  // مبدل‌های خروجی
  // ---------------------------------------------------------------------------

  private toEmployeeDto(entity: EmployeeEntity): EmployeeResponseDto {
    return {
      id: entity.id,
      employeeNumber: entity.employeeNumber,
      firstName: entity.firstName,
      lastName: entity.lastName,
      fullName: `${entity.firstName} ${entity.lastName}`.trim(),
      nationalId: entity.nationalId,
      fatherName: entity.fatherName,
      birthDate: this.toIso(entity.birthDate),
      gender: entity.gender,
      mobile: entity.mobile,
      email: entity.email,
      jobTitle: entity.jobTitle,
      department: entity.department,
      maritalStatus: entity.maritalStatus,
      dependants: entity.dependants,
      status: entity.status,
      hireDate: entity.hireDate,
      terminationDate: this.toIso(entity.terminationDate),
      bankAccountNumber: entity.bankAccountNumber,
      insuranceNumber: entity.insuranceNumber ?? null,
      createdAt: this.toIso(entity.createdAt) ?? '',
      updatedAt: this.toIso(entity.updatedAt) ?? '',
    };
  }

  private toContractDto(entity: EmploymentContractEntity): ContractResponseDto {
    const employee = entity.employee;
    return {
      id: entity.id,
      contractNumber: entity.contractNumber,
      employeeId: entity.employeeId,
      employeeFullName: employee
        ? `${employee.firstName} ${employee.lastName}`.trim()
        : '',
      contractType: entity.contractType,
      startDate: entity.startDate,
      endDate: this.toIso(entity.endDate),
      jobTitle: entity.jobTitle,
      department: entity.department,
      baseSalary: this.round(Number(entity.baseSalary)),
      housingAllowance: this.round(Number(entity.housingAllowance)),
      foodAllowance: this.round(Number(entity.foodAllowance)),
      childAllowance: this.round(Number(entity.childAllowance)),
      insuranceRate: Number(entity.insuranceRate),
      isInsuranceSubject: entity.isInsuranceSubject,
      taxRegime: entity.taxRegime,
      status: entity.status,
      description: entity.description,
      createdAt: this.toIso(entity.createdAt) ?? '',
      updatedAt: this.toIso(entity.updatedAt) ?? '',
    };
  }

  toPayslipDto(entity: PayslipEntity): PayslipResponseDto {
    const employee = entity.employee;
    return {
      id: entity.id,
      payslipNumber: entity.payslipNumber,
      employeeId: entity.employeeId,
      employeeFullName: employee
        ? `${employee.firstName} ${employee.lastName}`.trim()
        : '',
      employeeNumber: employee?.employeeNumber ?? '',
      contractId: entity.contractId,
      periodYear: entity.periodYear,
      periodMonth: entity.periodMonth,
      baseSalary: this.round(Number(entity.baseSalary)),
      housingAllowance: this.round(Number(entity.housingAllowance)),
      foodAllowance: this.round(Number(entity.foodAllowance)),
      childAllowance: this.round(Number(entity.childAllowance)),
      marriageAllowance: this.round(Number(entity.marriageAllowance ?? 0)),
      allowancesTotal: this.round(Number(entity.allowancesTotal ?? 0)),
      allowanceLines: entity.allowanceLines ?? [],
      eidiAmount: this.round(Number(entity.eidiAmount ?? 0)),
      taxableIncome: this.round(Number(entity.taxableIncome ?? 0)),
      flatTax: this.round(Number(entity.flatTax ?? 0)),
      monthDays: Number(entity.monthDays ?? 0),
      overtimeAmount: this.round(Number(entity.overtimeAmount)),
      payrollRunId: entity.payrollRunId ?? null,
      seniorityAmount: this.round(Number(entity.seniorityAmount ?? 0)),
      nightShiftAmount: this.round(Number(entity.nightShiftAmount ?? 0)),
      holidayAmount: this.round(Number(entity.holidayAmount ?? 0)),
      absenceDeduction: this.round(Number(entity.absenceDeduction ?? 0)),
      insurableWage: this.round(Number(entity.insurableWage ?? 0)),
      employerInsurance: this.round(Number(entity.employerInsurance ?? 0)),
      unemploymentInsurance: this.round(
        Number(entity.unemploymentInsurance ?? 0),
      ),
      workDays: Number(entity.workDays ?? 0),
      overtimeHours: Number(entity.overtimeHours ?? 0),
      nightHours: Number(entity.nightHours ?? 0),
      holidayHours: Number(entity.holidayHours ?? 0),
      absenceDays: Number(entity.absenceDays ?? 0),
      grossPay: this.round(Number(entity.grossPay)),
      insuranceDeduction: this.round(Number(entity.insuranceDeduction)),
      incomeTax: this.round(Number(entity.incomeTax)),
      otherDeductions: this.round(Number(entity.otherDeductions)),
      netPay: this.round(Number(entity.netPay)),
      status: entity.status,
      journalEntryId: entity.journalEntryId,
      journalEntryNumber: entity.journalEntryNumber,
      issuedAt: this.toIso(entity.issuedAt) ?? '',
      createdAt: this.toIso(entity.createdAt) ?? '',
    };
  }

  // ---------------------------------------------------------------------------
  // کارگزینی پرسنل
  // ---------------------------------------------------------------------------

  private async generateEmployeeNumber(tenantId: string): Promise<string> {
    let sequence = (await this.hrRepository.countEmployees(tenantId)) + 1;
    let candidate = `${EMPLOYEE_NUMBER_PREFIX}-${this.pad(sequence, 6)}`;
    while (await this.hrRepository.findEmployeeByNumber(tenantId, candidate)) {
      sequence += 1;
      candidate = `${EMPLOYEE_NUMBER_PREFIX}-${this.pad(sequence, 6)}`;
    }
    return candidate;
  }

  async createEmployee(
    tenantId: string,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const existingNationalId =
      await this.hrRepository.findEmployeeByNationalId(tenantId, dto.nationalId);
    if (existingNationalId) {
      throw new ConflictException(
        `کارمندی با کد ملی ${dto.nationalId} قبلاً ثبت شده است.`,
      );
    }

    const employeeNumber =
      dto.employeeNumber ?? (await this.generateEmployeeNumber(tenantId));

    const existingNumber =
      await this.hrRepository.findEmployeeByNumber(tenantId, employeeNumber);
    if (existingNumber) {
      throw new ConflictException(
        `کد پرسنلی ${employeeNumber} قبلاً استفاده شده است.`,
      );
    }

    const created = await this.hrRepository.createEmployee(tenantId, {
      employeeNumber,
      firstName: dto.firstName,
      lastName: dto.lastName,
      nationalId: dto.nationalId,
      fatherName: dto.fatherName ?? null,
      birthDate: dto.birthDate ?? null,
      gender: dto.gender ?? Gender.MALE,
      mobile: dto.mobile,
      email: dto.email ?? null,
      jobTitle: dto.jobTitle,
      department: dto.department,
      maritalStatus: dto.maritalStatus ?? MaritalStatus.SINGLE,
      dependants: dto.dependants ?? 0,
      status: EmployeeStatus.ACTIVE,
      hireDate: dto.hireDate ?? new Date().toISOString().slice(0, 10),
      terminationDate: null,
      bankAccountNumber: dto.bankAccountNumber ?? null,
      insuranceNumber: dto.insuranceNumber ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return this.toEmployeeDto(created);
  }

  /**
   * درج کارمندان از مسیر ورود داده.
   *
   * تشخیص تکراری کد ملی پیش از فراخوانی این متد در لایه ورود داده انجام شده
   * است؛ در صورت نبود `employeeNumber` سرویس کد پرسنلی یکتا تولید می‌کند.
   * خروجی، شناسه کارمندان ایجادشده به‌ترتیب ورودی است.
   */
  async importEmployees(
    tenantId: string,
    inputs: HrImportEmployeeInput[],
  ): Promise<number[]> {
    const createdIds: number[] = [];
    for (const input of inputs) {
      const employeeNumber =
        input.employeeNumber?.trim() ||
        (await this.generateEmployeeNumber(tenantId));

      const created = await this.hrRepository.createEmployee(tenantId, {
        employeeNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        nationalId: input.nationalId,
        fatherName: input.fatherName ?? null,
        birthDate: input.birthDate ?? null,
        gender: input.gender ?? Gender.MALE,
        mobile: input.mobile,
        email: input.email ?? null,
        jobTitle: input.jobTitle,
        department: input.department,
        maritalStatus: input.maritalStatus ?? MaritalStatus.SINGLE,
        dependants: input.dependants ?? 0,
        status: EmployeeStatus.ACTIVE,
        hireDate: input.hireDate ?? new Date().toISOString().slice(0, 10),
        terminationDate: null,
        bankAccountNumber: input.bankAccountNumber ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(created.id);
    }
    return createdIds;
  }

  /** کدهای ملی موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری ورود). */
  async findExistingNationalIds(
    tenantId: string,
    nationalIds: string[],
  ): Promise<string[]> {
    return this.hrRepository.findEmployeeNationalIds(tenantId, nationalIds);
  }

  /**
   * حذف کارمندان یک دسته ورود داده.
   * کارمند دارای قرارداد یا فیش حقوقی «ارجاع‌شده» است و حذف نمی‌شود.
   */
  async removeImportedEmployees(
    tenantId: string,
    ids: number[],
  ): Promise<{ removed: number; refused: number[] }> {
    if (ids.length === 0) {
      return { removed: 0, refused: [] };
    }
    const referenced = new Set(
      await this.hrRepository.findReferencedEmployeeIds(tenantId, ids),
    );
    const deletable = ids.filter((id) => !referenced.has(id));
    const removed = await this.hrRepository.deleteEmployeesByIds(
      tenantId,
      deletable,
    );
    return { removed, refused: Array.from(referenced) };
  }

  async listEmployees(
    tenantId: string,
    query: QueryEmployeeDto,
  ): Promise<PaginatedEmployeeResponseDto> {    const { page, limit, search, status, department } = query;

    const baseConditions = search
      ? HrRepository.buildEmployeeSearchWhere(tenantId, search)
      : [{ tenantId } as FindOptionsWhere<EmployeeEntity>];

    const where = baseConditions.map((condition) => ({
      ...condition,
      ...(status ? { status } : {}),
      ...(department ? { department } : {}),
    }));

    const [entities, total] = await this.hrRepository.findAndCountEmployees(
      tenantId,
      {
        where,
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      },
    );

    return {
      data: entities.map((entity) => this.toEmployeeDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOneEmployee(
    tenantId: string,
    id: number,
  ): Promise<EmployeeResponseDto> {
    const entity = await this.hrRepository.findEmployeeById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`کارمند با شناسه ${id} یافت نشد.`);
    }
    return this.toEmployeeDto(entity);
  }

  /**
   * Preview of the end-of-service benefit and leave pay. Writes nothing. Day basis and days per
   * year come from the statutory store as of the end date; the daily wage is the active
   * contract's base salary over the payroll month days.
   */
  async previewSettlement(
    tenantId: string,
    employeeId: number,
    dto: PreviewSettlementDto,
  ): Promise<SettlementPreviewDto> {
    const employee = await this.hrRepository.findEmployeeById(tenantId, employeeId);
    if (!employee) {
      throw new NotFoundException(`کارمند با شناسه ${employeeId} یافت نشد.`);
    }
    const contract = await this.hrRepository.findActiveContractByEmployee(tenantId, employeeId);
    if (!contract) {
      throw new BadRequestException('کارمند قرارداد فعال ندارد؛ مزد روزانه مشخص نیست.');
    }
    const terms = await this.statutory.settlementTermsOn(tenantId, dto.endDate.slice(0, 10));
    const monthDays = BigInt(terms.monthDays);
    const dailyWage =
      (2n * BigInt(Math.round(Number(contract.baseSalary))) + monthDays) / (2n * monthDays);
    let result: ReturnType<typeof calculateEndOfService>;
    try {
      result = calculateEndOfService({
        hireDate: employee.hireDate,
        terminationDate: dto.endDate,
        dailyWage,
        daysPerYear: terms.daysPerYear,
        yearDays: terms.yearDays,
        unusedLeaveDays: dto.unusedLeaveDays,
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(
          error.message === 'terminationDate is before hireDate'
            ? 'تاریخ پایان خدمت قبل از تاریخ استخدام است.'
            : error.message,
        );
      }
      throw error;
    }
    return {
      employeeId,
      hireDate: employee.hireDate.slice(0, 10),
      endDate: dto.endDate.slice(0, 10),
      fullYears: result.fullYears,
      extraDays: result.extraDays,
      dailyWage: dailyWage.toString(),
      unusedLeaveDays: dto.unusedLeaveDays ?? 0,
      endOfServiceBenefit: result.endOfServiceBenefit.toString(),
      leaveSettlement: result.leaveSettlement.toString(),
      total: result.total.toString(),
      parameters: terms.parameters,
    };
  }

  async updateEmployee(
    tenantId: string,
    id: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const entity = await this.hrRepository.findEmployeeById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`کارمند با شناسه ${id} یافت نشد.`);
    }

    if (dto.nationalId && dto.nationalId !== entity.nationalId) {
      const clash = await this.hrRepository.findEmployeeByNationalId(
        tenantId,
        dto.nationalId,
      );
      if (clash) {
        throw new ConflictException(
          `کارمندی با کد ملی ${dto.nationalId} قبلاً ثبت شده است.`,
        );
      }
    }

    if (dto.employeeNumber && dto.employeeNumber !== entity.employeeNumber) {
      const clash = await this.hrRepository.findEmployeeByNumber(
        tenantId,
        dto.employeeNumber,
      );
      if (clash) {
        throw new ConflictException(
          `کد پرسنلی ${dto.employeeNumber} قبلاً استفاده شده است.`,
        );
      }
    }

    Object.assign(entity, {
      ...(dto.employeeNumber !== undefined
        ? { employeeNumber: dto.employeeNumber }
        : {}),
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.nationalId !== undefined ? { nationalId: dto.nationalId } : {}),
      ...(dto.fatherName !== undefined ? { fatherName: dto.fatherName } : {}),
      ...(dto.birthDate !== undefined ? { birthDate: dto.birthDate } : {}),
      ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
      ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle } : {}),
      ...(dto.department !== undefined ? { department: dto.department } : {}),
      ...(dto.maritalStatus !== undefined
        ? { maritalStatus: dto.maritalStatus }
        : {}),
      ...(dto.dependants !== undefined ? { dependants: dto.dependants } : {}),
      ...(dto.hireDate !== undefined ? { hireDate: dto.hireDate } : {}),
      ...(dto.bankAccountNumber !== undefined
        ? { bankAccountNumber: dto.bankAccountNumber }
        : {}),
      ...(dto.insuranceNumber !== undefined
        ? { insuranceNumber: dto.insuranceNumber }
        : {}),
      updatedAt: new Date(),
    });

    const saved = await this.hrRepository.saveEmployee(tenantId, entity);
    return this.toEmployeeDto(saved);
  }

  // ---------------------------------------------------------------------------
  // احکام و قراردادهای حقوقی
  // ---------------------------------------------------------------------------

  async createContract(
    tenantId: string,
    dto: CreateContractDto,
  ): Promise<ContractResponseDto> {
    const employee = await this.hrRepository.findEmployeeById(
      tenantId,
      dto.employeeId,
    );
    if (!employee) {
      throw new NotFoundException(
        `کارمند با شناسه ${dto.employeeId} یافت نشد.`,
      );
    }

    const contractNumber =
      dto.contractNumber ??
      `${CONTRACT_NUMBER_PREFIX}-${dto.employeeId}-${Date.now()}`;

    const existing = await this.hrRepository.findContractByNumber(
      tenantId,
      contractNumber,
    );
    if (existing) {
      throw new ConflictException(
        `قراردادی با شماره ${contractNumber} قبلاً ثبت شده است.`,
      );
    }

    if (dto.endDate && dto.endDate < dto.startDate) {
      throw new BadRequestException(
        'تاریخ پایان قرارداد نمی‌تواند قبل از تاریخ شروع باشد.',
      );
    }

    const rates = await this.statutory.ratesForLatestUpTo(
      tenantId,
      gregorianToJalali(dto.startDate)?.jy,
    );
    const contract = await this.hrRepository.createContract(tenantId, {
      contractNumber,
      employeeId: employee.id,
      contractType: dto.contractType ?? undefined,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      jobTitle: dto.jobTitle ?? employee.jobTitle,
      department: dto.department ?? employee.department,
      baseSalary: this.round(dto.baseSalary),
      housingAllowance: this.round(
        dto.housingAllowance ?? rates.housingAllowance,
      ),
      foodAllowance: this.round(dto.foodAllowance ?? rates.foodAllowance),
      childAllowance: this.round(dto.childAllowance ?? 0),
      insuranceRate: dto.insuranceRate ?? rates.employeeInsuranceRate,
      isInsuranceSubject: dto.isInsuranceSubject ?? true,
      taxRegime: dto.taxRegime ?? WageTaxRegime.STANDARD,
      status: ContractStatus.ACTIVE,
      description: dto.description ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return this.toContractDto({
      ...contract,
      employee,
    });
  }

  async listAllowances(
    tenantId: string,
    contractId: number,
  ): Promise<ContractAllowanceDto[]> {
    await this.findOneContract(tenantId, contractId);
    const rows = await this.hrRepository.findAllowancesByContractIds(tenantId, [
      contractId,
    ]);
    return rows.map(({ title, amount, insurable, taxTreatment }) => ({
      title,
      amount: Number(amount),
      insurable,
      taxTreatment,
    }));
  }

  async replaceAllowances(
    tenantId: string,
    contractId: number,
    dto: ReplaceAllowancesDto,
  ): Promise<ContractAllowanceDto[]> {
    await this.findOneContract(tenantId, contractId);
    await this.hrRepository.replaceAllowances(
      tenantId,
      contractId,
      dto.allowances,
    );
    return this.listAllowances(tenantId, contractId);
  }

  async listContracts(
    tenantId: string,
    employeeId?: number,
  ): Promise<ContractResponseDto[]> {
    const [entities] = await this.hrRepository.findAndCountContracts(tenantId, {
      where: employeeId ? { employeeId, tenantId } : { tenantId },
      relations: { employee: true },
      order: { startDate: 'DESC', id: 'DESC' },
    });
    return entities.map((entity) => this.toContractDto(entity));
  }

  async findOneContract(
    tenantId: string,
    id: number,
  ): Promise<ContractResponseDto> {
    const entity = await this.hrRepository.findContractById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`قرارداد با شناسه ${id} یافت نشد.`);
    }
    return this.toContractDto(entity);
  }

  // ---------------------------------------------------------------------------
  // محاسبه حقوق و دستمزد
  // ---------------------------------------------------------------------------

  /**
   * Single-payslip calculation on a contract: delegates to the shared engine
   * (services/payroll-calculator.ts) used by the monthly payroll run.
   */
  private async computePayroll(
    tenantId: string,
    contract: EmploymentContractEntity,
    options: {
      overtimeAmount?: number;
      otherDeductions?: number;
      periodYear?: number;
      yearToDate?: PayrollYearToDate;
      monthDays?: number;
    },
  ): Promise<
    Omit<PayrollCalculationResponseDto, 'employeeFullName' | 'employeeId'>
  > {
    // Same engine and versioned rates as the monthly payroll run; the contract
    // may override the employee insurance rate.
    const rates = await this.statutory.ratesForLatestUpTo(
      tenantId,
      options.periodYear,
    );
    const result = calculatePayroll({
      rates,
      employeeInsuranceRate: String(contract.insuranceRate),
      taxRegime: contract.taxRegime,
      yearToDate: options.yearToDate,
      monthDays: options.monthDays,
      monthlyBaseWage: Number(contract.baseSalary),
      housingAllowance: Number(contract.housingAllowance),
      foodAllowance: Number(contract.foodAllowance),
      childAllowanceOverride: Number(contract.childAllowance),
      children: 0,
      seniorityYears: 0,
      fixedOvertimeAmount: options.overtimeAmount,
      otherDeductions: options.otherDeductions,
      insuranceSubject: contract.isInsuranceSubject,
    });

    if (result.netPay < 0) {
      throw new BadRequestException(
        'جمع کسورات از جمع حقوق و مزایا بیشتر است؛ محاسبه حقوق معتبر نیست.',
      );
    }

    return {
      contractId: contract.id,
      baseSalary: result.baseWage,
      housingAllowance: result.housingAllowance,
      foodAllowance: result.foodAllowance,
      childAllowance: result.childAllowance,
      overtimeAmount: result.overtimeAmount,
      grossPay: result.grossPay,
      insuranceDeduction: result.employeeInsurance,
      taxableIncome: result.taxableIncome,
      incomeTax: result.incomeTax,
      otherDeductions: result.otherDeductions,
      netPay: result.netPay,
    };
  }

  /**
   * تعیین قرارداد مبنای محاسبه: یا با `contractId` صریح یا آخرین قرارداد
   * فعال کارمند (`employeeId`).
   */
  private async resolveContract(
    tenantId: string,
    contractId?: number,
    employeeId?: number,
  ): Promise<{ contract: EmploymentContractEntity; employee: EmployeeEntity }> {
    if (contractId) {
      const contract = await this.hrRepository.findContractById(
        tenantId,
        contractId,
      );
      if (!contract) {
        throw new NotFoundException(
          `قرارداد با شناسه ${contractId} یافت نشد.`,
        );
      }
      const employee =
        contract.employee ??
        (await this.hrRepository.findEmployeeById(tenantId, contract.employeeId));
      if (!employee) {
        throw new NotFoundException('کارمند مرتبط با قرارداد یافت نشد.');
      }
      return { contract, employee };
    }

    if (employeeId) {
      const employee = await this.hrRepository.findEmployeeById(
        tenantId,
        employeeId,
      );
      if (!employee) {
        throw new NotFoundException(
          `کارمند با شناسه ${employeeId} یافت نشد.`,
        );
      }
      const contract = await this.hrRepository.findActiveContractByEmployee(
        tenantId,
        employeeId,
      );
      if (!contract) {
        throw new BadRequestException(
          `قرارداد فعالی برای کارمند ${employeeId} یافت نشد.`,
        );
      }
      return { contract, employee };
    }

    throw new BadRequestException(
      'برای محاسبه حقوق، یکی از contractId یا employeeId الزامی است.',
    );
  }

  async calculatePayroll(
    tenantId: string,
    dto: CalculatePayrollDto,
  ): Promise<PayrollCalculationResponseDto> {
    const { contract, employee } = await this.resolveContract(
      tenantId,
      dto.contractId,
      dto.employeeId,
    );

    const calculation = await this.computePayroll(tenantId, contract, {
      overtimeAmount: dto.overtimeAmount,
      otherDeductions: dto.otherDeductions,
    });

    return {
      ...calculation,
      employeeId: employee.id,
      employeeFullName: `${employee.firstName} ${employee.lastName}`.trim(),
    };
  }

  // ---------------------------------------------------------------------------
  // صدور فیش حقوقی و ثبت سند خودکار
  // ---------------------------------------------------------------------------

  async issuePayslip(
    tenantId: string,
    dto: IssuePayslipDto,
  ): Promise<PayslipResponseDto> {
    const { contract, employee } = await this.resolveContract(
      tenantId,
      dto.contractId,
      dto.employeeId,
    );

    const existing = await this.hrRepository.findPayslipByPeriod(
      tenantId,
      employee.id,
      dto.periodYear,
      dto.periodMonth,
    );
    if (existing) {
      throw new ConflictException(
        `فیش حقوقی دوره ${dto.periodYear}/${this.pad(dto.periodMonth, 2)} برای این کارمند قبلاً صادر شده است.`,
      );
    }

    const monthDays = jalaliMonthDays(dto.periodYear, dto.periodMonth);
    const calculation = await this.computePayroll(tenantId, contract, {
      overtimeAmount: dto.overtimeAmount,
      otherDeductions: dto.otherDeductions,
      periodYear: dto.periodYear,
      monthDays,
      yearToDate: yearToDateOf(
        await this.hrRepository.findIssuedPayslipsBefore(
          tenantId,
          [employee.id],
          dto.periodYear,
          dto.periodMonth,
        ),
      ),
    });

    if (calculation.grossPay <= 0) {
      throw new BadRequestException('جمع حقوق و مزایا باید بزرگ‌تر از صفر باشد.');
    }

    const payslipNumber = `${PAYSLIP_NUMBER_PREFIX}-${dto.periodYear}${this.pad(
      dto.periodMonth,
      2,
    )}-${employee.employeeNumber}`;
    const entryNumber = `PY-${payslipNumber}`;
    const payableTotal = this.round(
      calculation.insuranceDeduction +
        calculation.incomeTax +
        calculation.otherDeductions,
    );

    const lines: {
      accountCode: string;
      debit?: number;
      credit?: number;
      description?: string;
    }[] = [
      {
        accountCode: PAYROLL_EXPENSE_ACCOUNT_CODE,
        debit: calculation.grossPay,
        description: `هزینه حقوق و دستمزد ${employee.firstName} ${employee.lastName}`,
      },
    ];

    if (payableTotal > 0) {
      lines.push({
        accountCode: PAYROLL_PAYABLE_ACCOUNT_CODE,
        credit: payableTotal,
        description: 'کسورات بیمه و مالیات پرداختنی',
      });
    }
    if (calculation.netPay > 0) {
      lines.push({
        accountCode: PAYROLL_BANK_ACCOUNT_CODE,
        credit: calculation.netPay,
        description: 'خالص پرداختی حقوق',
      });
    }

    const journalEntry = await this.accountingService.createJournalEntry(
      tenantId,
      {
        entryNumber,
        date: new Date().toISOString(),
        description: `سند خودکار حقوق ${dto.periodYear}/${this.pad(
          dto.periodMonth,
          2,
        )} — ${employee.firstName} ${employee.lastName} (${payslipNumber})`,
        lines,
      },
    );

    const saved = await this.hrRepository.createPayslip(tenantId, {
      payslipNumber,
      employeeId: employee.id,
      contractId: contract.id,
      periodYear: dto.periodYear,
      periodMonth: dto.periodMonth,
      baseSalary: calculation.baseSalary,
      housingAllowance: calculation.housingAllowance,
      foodAllowance: calculation.foodAllowance,
      childAllowance: calculation.childAllowance,
      overtimeAmount: calculation.overtimeAmount,
      grossPay: calculation.grossPay,
      insuranceDeduction: calculation.insuranceDeduction,
      taxableIncome: calculation.taxableIncome,
      monthDays,
      incomeTax: calculation.incomeTax,
      otherDeductions: calculation.otherDeductions,
      netPay: calculation.netPay,
      status: PayslipStatus.ISSUED,
      journalEntryId: journalEntry.id,
      journalEntryNumber: journalEntry.entryNumber,
      issuedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return this.toPayslipDto({ ...saved, employee });
  }

  async listPayslips(
    tenantId: string,
    query: QueryPayslipDto,
  ): Promise<PaginatedPayslipResponseDto> {
    const { page, limit, employeeId, periodYear, periodMonth } = query;

    const where: FindOptionsWhere<PayslipEntity> = { tenantId };
    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (periodYear) {
      where.periodYear = periodYear;
    }
    if (periodMonth) {
      where.periodMonth = periodMonth;
    }

    const [entities, total] = await this.hrRepository.findAndCountPayslips(
      tenantId,
      {
        where,
        relations: { employee: true },
        order: { periodYear: 'DESC', periodMonth: 'DESC', id: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      },
    );

    return {
      data: entities.map((entity) => this.toPayslipDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOnePayslip(
    tenantId: string,
    id: number,
  ): Promise<PayslipResponseDto> {
    const entity = await this.hrRepository.findPayslipById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`فیش حقوقی با شناسه ${id} یافت نشد.`);
    }
    return this.toPayslipDto(entity);
  }

  // ---------------------------------------------------------------------------
  // آمار تحلیلی
  // ---------------------------------------------------------------------------

  async getStats(tenantId: string): Promise<HrStatsResponseDto> {
    const [
      totalEmployees,
      activeEmployees,
      onLeaveEmployees,
      terminatedEmployees,
      contractAggregate,
      payslipAggregate,
    ] = await Promise.all([
      this.hrRepository.countEmployees(tenantId),
      this.hrRepository.countEmployeesByStatus(tenantId, EmployeeStatus.ACTIVE),
      this.hrRepository.countEmployeesByStatus(
        tenantId,
        EmployeeStatus.ON_LEAVE,
      ),
      this.hrRepository.countEmployeesByStatus(
        tenantId,
        EmployeeStatus.TERMINATED,
      ),
      this.hrRepository.aggregateActiveContracts(tenantId),
      this.hrRepository.aggregatePayslips(tenantId),
    ]);

    const totalPayslips = Number(payslipAggregate.count);
    const totalGrossPay = this.round(Number(payslipAggregate.totalGrossPay));
    const totalNetPay = this.round(Number(payslipAggregate.totalNetPay));
    const totalInsurance = Number(payslipAggregate.totalInsurance);
    const totalTax = Number(payslipAggregate.totalTax);
    const totalOtherDeductions = Number(
      payslipAggregate.totalOtherDeductions,
    );

    return {
      totalEmployees,
      activeEmployees,
      onLeaveEmployees,
      terminatedEmployees,
      activeContracts: Number(contractAggregate.count),
      totalBaseSalary: this.round(Number(contractAggregate.totalBaseSalary)),
      totalGrossPay,
      totalNetPay,
      totalDeductions: this.round(
        totalInsurance + totalTax + totalOtherDeductions,
      ),
      totalPayslips,
      averageNetPay:
        totalPayslips > 0 ? this.round(totalNetPay / totalPayslips) : 0,
    };
  }
}
