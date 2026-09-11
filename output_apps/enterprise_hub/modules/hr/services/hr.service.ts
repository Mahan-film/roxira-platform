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
  DEFAULT_FOOD_ALLOWANCE,
  DEFAULT_HOUSING_ALLOWANCE,
  EMPLOYEE_INSURANCE_RATE,
  EMPLOYEE_NUMBER_PREFIX,
  INCOME_TAX_BRACKETS,
  INCOME_TAX_MONTHLY_EXEMPTION,
  MONEY_SCALE,
  PAYROLL_BANK_ACCOUNT_CODE,
  PAYROLL_EXPENSE_ACCOUNT_CODE,
  PAYROLL_PAYABLE_ACCOUNT_CODE,
  PAYSLIP_NUMBER_PREFIX,
} from '../constants/hr.constants';
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
} from '../enums/hr.enum';
import { HrRepository } from '../repositories/hr.repository';

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
      status: entity.status,
      description: entity.description,
      createdAt: this.toIso(entity.createdAt) ?? '',
      updatedAt: this.toIso(entity.updatedAt) ?? '',
    };
  }

  private toPayslipDto(entity: PayslipEntity): PayslipResponseDto {
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
      overtimeAmount: this.round(Number(entity.overtimeAmount)),
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

  private async generateEmployeeNumber(): Promise<string> {
    let sequence = (await this.hrRepository.countEmployees()) + 1;
    let candidate = `${EMPLOYEE_NUMBER_PREFIX}-${this.pad(sequence, 6)}`;
    while (await this.hrRepository.findEmployeeByNumber(candidate)) {
      sequence += 1;
      candidate = `${EMPLOYEE_NUMBER_PREFIX}-${this.pad(sequence, 6)}`;
    }
    return candidate;
  }

  async createEmployee(dto: CreateEmployeeDto): Promise<EmployeeResponseDto> {
    const existingNationalId =
      await this.hrRepository.findEmployeeByNationalId(dto.nationalId);
    if (existingNationalId) {
      throw new ConflictException(
        `کارمندی با کد ملی ${dto.nationalId} قبلاً ثبت شده است.`,
      );
    }

    const employeeNumber =
      dto.employeeNumber ?? (await this.generateEmployeeNumber());

    const existingNumber =
      await this.hrRepository.findEmployeeByNumber(employeeNumber);
    if (existingNumber) {
      throw new ConflictException(
        `کد پرسنلی ${employeeNumber} قبلاً استفاده شده است.`,
      );
    }

    const created = await this.hrRepository.createEmployee({
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return this.toEmployeeDto(created);
  }

  async listEmployees(
    query: QueryEmployeeDto,
  ): Promise<PaginatedEmployeeResponseDto> {
    const { page, limit, search, status, department } = query;

    const baseConditions = search
      ? HrRepository.buildEmployeeSearchWhere(search)
      : [{} as FindOptionsWhere<EmployeeEntity>];

    const where = baseConditions.map((condition) => ({
      ...condition,
      ...(status ? { status } : {}),
      ...(department ? { department } : {}),
    }));

    const [entities, total] = await this.hrRepository.findAndCountEmployees({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: entities.map((entity) => this.toEmployeeDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOneEmployee(id: number): Promise<EmployeeResponseDto> {
    const entity = await this.hrRepository.findEmployeeById(id);
    if (!entity) {
      throw new NotFoundException(`کارمند با شناسه ${id} یافت نشد.`);
    }
    return this.toEmployeeDto(entity);
  }

  async updateEmployee(
    id: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const entity = await this.hrRepository.findEmployeeById(id);
    if (!entity) {
      throw new NotFoundException(`کارمند با شناسه ${id} یافت نشد.`);
    }

    if (dto.nationalId && dto.nationalId !== entity.nationalId) {
      const clash = await this.hrRepository.findEmployeeByNationalId(
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
      updatedAt: new Date(),
    });

    const saved = await this.hrRepository.saveEmployee(entity);
    return this.toEmployeeDto(saved);
  }

  // ---------------------------------------------------------------------------
  // احکام و قراردادهای حقوقی
  // ---------------------------------------------------------------------------

  async createContract(
    dto: CreateContractDto,
  ): Promise<ContractResponseDto> {
    const employee = await this.hrRepository.findEmployeeById(dto.employeeId);
    if (!employee) {
      throw new NotFoundException(
        `کارمند با شناسه ${dto.employeeId} یافت نشد.`,
      );
    }

    const contractNumber =
      dto.contractNumber ??
      `${CONTRACT_NUMBER_PREFIX}-${dto.employeeId}-${Date.now()}`;

    const existing = await this.hrRepository.findContractByNumber(
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

    const contract = await this.hrRepository.createContract({
      contractNumber,
      employeeId: employee.id,
      contractType: dto.contractType ?? undefined,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      jobTitle: dto.jobTitle ?? employee.jobTitle,
      department: dto.department ?? employee.department,
      baseSalary: this.round(dto.baseSalary),
      housingAllowance: this.round(
        dto.housingAllowance ?? DEFAULT_HOUSING_ALLOWANCE,
      ),
      foodAllowance: this.round(dto.foodAllowance ?? DEFAULT_FOOD_ALLOWANCE),
      childAllowance: this.round(dto.childAllowance ?? 0),
      insuranceRate: dto.insuranceRate ?? EMPLOYEE_INSURANCE_RATE,
      isInsuranceSubject: dto.isInsuranceSubject ?? true,
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

  async listContracts(
    employeeId?: number,
  ): Promise<ContractResponseDto[]> {
    const [entities] = await this.hrRepository.findAndCountContracts({
      where: employeeId ? { employeeId } : {},
      relations: { employee: true },
      order: { startDate: 'DESC', id: 'DESC' },
    });
    return entities.map((entity) => this.toContractDto(entity));
  }

  async findOneContract(id: number): Promise<ContractResponseDto> {
    const entity = await this.hrRepository.findContractById(id);
    if (!entity) {
      throw new NotFoundException(`قرارداد با شناسه ${id} یافت نشد.`);
    }
    return this.toContractDto(entity);
  }

  // ---------------------------------------------------------------------------
  // محاسبه حقوق و دستمزد
  // ---------------------------------------------------------------------------

  /**
   * محاسبه مالیات بر حقوق بر اساس پله‌های تصاعدی روی درآمد مشمول
   * (پس از کسر معافیت ماهانه).
   */
  private calculateIncomeTax(taxableIncome: number): number {
    if (taxableIncome <= 0) {
      return 0;
    }
    let remaining = taxableIncome;
    let lower = 0;
    let tax = 0;
    for (const bracket of INCOME_TAX_BRACKETS) {
      if (remaining <= 0) {
        break;
      }
      const width = bracket.limit - lower;
      const slice =
        width === Number.POSITIVE_INFINITY
          ? remaining
          : Math.min(remaining, width);
      tax += slice * bracket.rate;
      remaining -= slice;
      lower = bracket.limit;
    }
    return this.round(tax);
  }

  /**
   * موتور محاسبه حقوق: اجزای حقوق و مزایا → ناخالص → کسر بیمه ۷٪ سهم
   * کارگر → مالیات بر حقوق → خالص پرداختی.
   */
  private computePayroll(
    contract: EmploymentContractEntity,
    options: { overtimeAmount?: number; otherDeductions?: number },
  ): Omit<PayrollCalculationResponseDto, 'employeeFullName' | 'employeeId'> {
    const baseSalary = this.round(Number(contract.baseSalary));
    const housingAllowance = this.round(Number(contract.housingAllowance));
    const foodAllowance = this.round(Number(contract.foodAllowance));
    const childAllowance = this.round(Number(contract.childAllowance));
    const overtimeAmount = this.round(options.overtimeAmount ?? 0);
    const otherDeductions = this.round(options.otherDeductions ?? 0);

    const grossPay = this.round(
      baseSalary +
        housingAllowance +
        foodAllowance +
        childAllowance +
        overtimeAmount,
    );

    const insuranceDeduction = contract.isInsuranceSubject
      ? this.round(grossPay * Number(contract.insuranceRate))
      : 0;

    const taxableIncome = this.round(
      Math.max(0, grossPay - insuranceDeduction),
    );

    const incomeTax = this.calculateIncomeTax(
      Math.max(0, taxableIncome - INCOME_TAX_MONTHLY_EXEMPTION),
    );

    const netPay = this.round(
      grossPay - insuranceDeduction - incomeTax - otherDeductions,
    );

    if (netPay < 0) {
      throw new BadRequestException(
        'جمع کسورات از جمع حقوق و مزایا بیشتر است؛ محاسبه حقوق معتبر نیست.',
      );
    }

    return {
      contractId: contract.id,
      baseSalary,
      housingAllowance,
      foodAllowance,
      childAllowance,
      overtimeAmount,
      grossPay,
      insuranceDeduction,
      taxableIncome,
      incomeTax,
      otherDeductions,
      netPay,
    };
  }

  /**
   * تعیین قرارداد مبنای محاسبه: یا با `contractId` صریح یا آخرین قرارداد
   * فعال کارمند (`employeeId`).
   */
  private async resolveContract(
    contractId?: number,
    employeeId?: number,
  ): Promise<{ contract: EmploymentContractEntity; employee: EmployeeEntity }> {
    if (contractId) {
      const contract = await this.hrRepository.findContractById(contractId);
      if (!contract) {
        throw new NotFoundException(
          `قرارداد با شناسه ${contractId} یافت نشد.`,
        );
      }
      const employee =
        contract.employee ??
        (await this.hrRepository.findEmployeeById(contract.employeeId));
      if (!employee) {
        throw new NotFoundException('کارمند مرتبط با قرارداد یافت نشد.');
      }
      return { contract, employee };
    }

    if (employeeId) {
      const employee = await this.hrRepository.findEmployeeById(employeeId);
      if (!employee) {
        throw new NotFoundException(
          `کارمند با شناسه ${employeeId} یافت نشد.`,
        );
      }
      const contract =
        await this.hrRepository.findActiveContractByEmployee(employeeId);
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
    dto: CalculatePayrollDto,
  ): Promise<PayrollCalculationResponseDto> {
    const { contract, employee } = await this.resolveContract(
      dto.contractId,
      dto.employeeId,
    );

    const calculation = this.computePayroll(contract, {
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

  async issuePayslip(dto: IssuePayslipDto): Promise<PayslipResponseDto> {
    const { contract, employee } = await this.resolveContract(
      dto.contractId,
      dto.employeeId,
    );

    const existing = await this.hrRepository.findPayslipByPeriod(
      employee.id,
      dto.periodYear,
      dto.periodMonth,
    );
    if (existing) {
      throw new ConflictException(
        `فیش حقوقی دوره ${dto.periodYear}/${this.pad(dto.periodMonth, 2)} برای این کارمند قبلاً صادر شده است.`,
      );
    }

    const calculation = this.computePayroll(contract, {
      overtimeAmount: dto.overtimeAmount,
      otherDeductions: dto.otherDeductions,
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

    const journalEntry = await this.accountingService.createJournalEntry({
      entryNumber,
      date: new Date().toISOString(),
      description: `سند خودکار حقوق ${dto.periodYear}/${this.pad(
        dto.periodMonth,
        2,
      )} — ${employee.firstName} ${employee.lastName} (${payslipNumber})`,
      lines,
    });

    const saved = await this.hrRepository.createPayslip({
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
    query: QueryPayslipDto,
  ): Promise<PaginatedPayslipResponseDto> {
    const { page, limit, employeeId, periodYear, periodMonth } = query;

    const where: FindOptionsWhere<PayslipEntity> = {};
    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (periodYear) {
      where.periodYear = periodYear;
    }
    if (periodMonth) {
      where.periodMonth = periodMonth;
    }

    const [entities, total] = await this.hrRepository.findAndCountPayslips({
      where,
      relations: { employee: true },
      order: { periodYear: 'DESC', periodMonth: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: entities.map((entity) => this.toPayslipDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOnePayslip(id: number): Promise<PayslipResponseDto> {
    const entity = await this.hrRepository.findPayslipById(id);
    if (!entity) {
      throw new NotFoundException(`فیش حقوقی با شناسه ${id} یافت نشد.`);
    }
    return this.toPayslipDto(entity);
  }

  // ---------------------------------------------------------------------------
  // آمار تحلیلی
  // ---------------------------------------------------------------------------

  async getStats(): Promise<HrStatsResponseDto> {
    const [
      totalEmployees,
      activeEmployees,
      onLeaveEmployees,
      terminatedEmployees,
      contractAggregate,
      payslipAggregate,
    ] = await Promise.all([
      this.hrRepository.countEmployees(),
      this.hrRepository.countEmployeesByStatus(EmployeeStatus.ACTIVE),
      this.hrRepository.countEmployeesByStatus(EmployeeStatus.ON_LEAVE),
      this.hrRepository.countEmployeesByStatus(EmployeeStatus.TERMINATED),
      this.hrRepository.aggregateActiveContracts(),
      this.hrRepository.aggregatePayslips(),
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
