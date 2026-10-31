import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { AccountingService } from '../../accounting/services/accounting.service';
import {
  PAYROLL_RUN_ACCOUNTS,
  PAYROLL_RUN_ENTRY_PREFIX,
  PAYSLIP_NUMBER_PREFIX,
} from '../constants/hr.constants';
import {
  CreatePayrollRunDto,
  InsuranceListQueryDto,
  InsuranceListResponseDto,
  PayrollRatesResponseDto,
  PayrollRunItemDto,
  PayrollRunResponseDto,
  PayrollRunSkippedDto,
} from '../dto/payroll-run.dto';
import { EmployeeEntity } from '../entities/employee.entity';
import { EmploymentContractEntity } from '../entities/employment-contract.entity';
import { PayrollRunEntity } from '../entities/payroll-run.entity';
import { PayslipEntity } from '../entities/payslip.entity';
import {
  PAYROLL_RUN_STATUS_LABELS,
  PayrollRunStatus,
  PayslipStatus,
} from '../enums/hr.enum';
import { HrRepository } from '../repositories/hr.repository';
import { PayrollYearRates } from '../statutory/payroll-rates';
import { StatutoryService } from '../statutory/statutory.service';
import { HrService } from './hr.service';
import { buildInsuranceList, InsuranceListWorker } from './insurance-list';
import {
  compactJalali,
  isoDate,
  jalaliMonthEnd,
  jalaliMonthStart,
} from './jalali-period';
import { calculatePayroll, serviceYears } from './payroll-calculator';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  } | null;
  return (
    candidate?.code === PG_UNIQUE_VIOLATION ||
    candidate?.driverError?.code === PG_UNIQUE_VIOLATION
  );
}

interface JournalLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

/**
 * Monthly payroll runs per tenant per Jalali month (Business suite phase 2).
 *
 * Calculation is delegated to the pure `calculatePayroll` engine with the
 * statutory values in force for the period (`StatutoryService`).
 * Every repository call carries the tenant id from the verified JWT.
 */
@Injectable()
export class PayrollRunService {
  constructor(
    private readonly hrRepository: HrRepository,
    private readonly hrService: HrService,
    private readonly accountingService: AccountingService,
    private readonly statutory: StatutoryService,
  ) {}

  private async requireRates(
    tenantId: string,
    year: number,
    month?: number,
  ): Promise<PayrollYearRates> {
    if (!(await this.statutory.hasYear(tenantId, year))) {
      throw new BadRequestException(
        `نرخ‌های قانونی حقوق برای سال ${year} تعریف نشده است.`,
      );
    }
    return this.statutory.ratesFor(tenantId, year, month);
  }

  async getRates(
    tenantId: string,
    year: number,
  ): Promise<PayrollRatesResponseDto> {
    const rates = await this.requireRates(tenantId, year);
    return {
      year: rates.year,
      source: rates.source,
      verified: rates.verified,
      unverifiedKeys: rates.unverifiedKeys,
      minDailyWage: rates.minDailyWage,
      minMonthlyWage: rates.minMonthlyWage,
      housingAllowance: rates.housingAllowance,
      foodAllowance: rates.foodAllowance,
      childAllowancePerChild: rates.childAllowancePerChild,
      seniorityPerYear: rates.seniorityPerYear,
      monthlyWorkHours: rates.monthlyWorkHours,
      overtimePremium: rates.overtimePremium,
      nightShiftPremium: rates.nightShiftPremium,
      holidayPremium: rates.holidayPremium,
      employeeInsuranceRate: rates.employeeInsuranceRate,
      employerInsuranceRate: rates.employerInsuranceRate,
      unemploymentInsuranceRate: rates.unemploymentInsuranceRate,
      maxInsurableMonthlyWage: rates.maxInsurableMonthlyWage,
      taxBrackets: rates.taxBrackets.map((bracket) => ({
        upTo: Number.isFinite(bracket.upTo) ? bracket.upTo : null,
        rate: bracket.rate,
      })),
    };
  }

  private fullName(employee: EmployeeEntity): string {
    return `${employee.firstName} ${employee.lastName}`.trim();
  }

  private toRunDto(
    run: PayrollRunEntity,
    payslips: PayslipEntity[],
    skipped: PayrollRunSkippedDto[] = [],
  ): PayrollRunResponseDto {
    const iso = (value: Date | null | undefined): string | null =>
      value ? new Date(value).toISOString() : null;
    return {
      id: run.id,
      periodYear: run.periodYear,
      periodMonth: run.periodMonth,
      status: run.status,
      statusLabel: PAYROLL_RUN_STATUS_LABELS[run.status] ?? run.status,
      ratesYear: run.ratesYear,
      employeeCount: run.employeeCount,
      totalGross: Number(run.totalGross),
      totalInsurable: Number(run.totalInsurable),
      totalEmployeeInsurance: Number(run.totalEmployeeInsurance),
      totalEmployerInsurance: Number(run.totalEmployerInsurance),
      totalUnemploymentInsurance: Number(run.totalUnemploymentInsurance),
      totalIncomeTax: Number(run.totalIncomeTax),
      totalOtherDeductions: Number(run.totalOtherDeductions),
      totalNet: Number(run.totalNet),
      journalEntryId: run.journalEntryId,
      journalEntryNumber: run.journalEntryNumber,
      postedAt: iso(run.postedAt),
      createdAt: iso(run.createdAt) ?? '',
      payslips: payslips.map((payslip) => this.hrService.toPayslipDto(payslip)),
      skipped,
    };
  }

  /**
   * Calculate (or recalculate) the DRAFT run of a period for every active
   * employee with an active contract. A POSTED run is frozen.
   */
  async createOrRecalculate(
    tenantId: string,
    dto: CreatePayrollRunDto,
  ): Promise<PayrollRunResponseDto> {
    const rates = await this.requireRates(
      tenantId,
      dto.periodYear,
      dto.periodMonth,
    );
    const items = new Map<number, PayrollRunItemDto>();
    for (const item of dto.items ?? []) {
      items.set(item.employeeId, item);
    }

    // Run header, payslips and totals commit together (a failed recalculation
    // never leaves a run with half its payslips).
    let saved: { run: PayrollRunEntity; skipped: PayrollRunSkippedDto[] };
    try {
      saved = await this.hrRepository.runInTransaction(async (manager) => {
        let run = await this.hrRepository.findPayrollRunByPeriod(
          tenantId,
          dto.periodYear,
          dto.periodMonth,
          manager,
        );
        if (run && run.status === PayrollRunStatus.POSTED) {
          throw new ConflictException(
            `حقوق دوره ${dto.periodYear}/${dto.periodMonth} قبلاً در حسابداری ثبت شده و قابل محاسبه مجدد نیست.`,
          );
        }
        if (run) {
          await this.hrRepository.deletePayslipsByRun(tenantId, run.id, manager);
        } else {
          run = await this.hrRepository.createPayrollRun(
            tenantId,
            {
              periodYear: dto.periodYear,
              periodMonth: dto.periodMonth,
              status: PayrollRunStatus.DRAFT,
              ratesYear: rates.year,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            manager,
          );
        }

        const employees = await this.hrRepository.findActiveEmployees(tenantId);
        const contracts = await this.hrRepository.findActiveContractsByEmployeeIds(
          tenantId,
          employees.map((employee) => employee.id),
        );
        const contractByEmployee = new Map<number, EmploymentContractEntity>();
        for (const contract of contracts) {
          if (!contractByEmployee.has(contract.employeeId)) {
            contractByEmployee.set(contract.employeeId, contract);
          }
        }
        const legacyPayslips = new Set(
          (
            await this.hrRepository.findPayslipsOfPeriod(
              tenantId,
              dto.periodYear,
              dto.periodMonth,
            )
          )
            .filter((payslip) => payslip.payrollRunId !== run!.id)
            .map((payslip) => payslip.employeeId),
        );

        const periodEnd = jalaliMonthEnd(dto.periodYear, dto.periodMonth);
        const month = String(dto.periodMonth).padStart(2, '0');
        const skipped: PayrollRunSkippedDto[] = [];
        const rows: Partial<PayslipEntity>[] = [];
        const now = new Date();

        for (const employee of employees) {
          const contract = contractByEmployee.get(employee.id);
          if (!contract) {
            skipped.push({
              employeeId: employee.id,
              employeeFullName: this.fullName(employee),
              reason: 'قرارداد فعال ندارد.',
            });
            continue;
          }
          if (legacyPayslips.has(employee.id)) {
            skipped.push({
              employeeId: employee.id,
              employeeFullName: this.fullName(employee),
              reason: 'برای این دوره فیش جداگانه صادر شده است.',
            });
            continue;
          }
          const item = items.get(employee.id);
          const result = calculatePayroll({
            rates: {
              ...rates,
              employeeInsuranceRate: Number(
                contract.insuranceRate ?? rates.employeeInsuranceRate,
              ),
            },
            monthlyBaseWage: Number(contract.baseSalary),
            housingAllowance: Number(contract.housingAllowance),
            foodAllowance: Number(contract.foodAllowance),
            childAllowanceOverride: Number(contract.childAllowance),
            children: employee.dependants ?? 0,
            seniorityYears: serviceYears(employee.hireDate, periodEnd),
            overtimeHours: item?.overtimeHours,
            nightHours: item?.nightHours,
            holidayHours: item?.holidayHours,
            absenceDays: item?.absenceDays,
            otherDeductions: item?.otherDeductions,
            insuranceSubject: contract.isInsuranceSubject,
          });
          if (result.netPay < 0) {
            skipped.push({
              employeeId: employee.id,
              employeeFullName: this.fullName(employee),
              reason: 'جمع کسورات از حقوق و مزایا بیشتر است.',
            });
            continue;
          }
          rows.push({
            payrollRunId: run.id,
            payslipNumber: `${PAYSLIP_NUMBER_PREFIX}-${dto.periodYear}${month}-${employee.employeeNumber}`,
            employeeId: employee.id,
            contractId: contract.id,
            periodYear: dto.periodYear,
            periodMonth: dto.periodMonth,
            baseSalary: result.baseWage,
            seniorityAmount: result.seniorityAmount,
            housingAllowance: result.housingAllowance,
            foodAllowance: result.foodAllowance,
            childAllowance: result.childAllowance,
            overtimeAmount: result.overtimeAmount,
            nightShiftAmount: result.nightShiftAmount,
            holidayAmount: result.holidayAmount,
            absenceDeduction: result.absenceDeduction,
            grossPay: result.grossPay,
            insurableWage: result.insurableWage,
            insuranceDeduction: result.employeeInsurance,
            employerInsurance: result.employerInsurance,
            unemploymentInsurance: result.unemploymentInsurance,
            incomeTax: result.incomeTax,
            otherDeductions: result.otherDeductions,
            netPay: result.netPay,
            workDays: result.workDays,
            overtimeHours: item?.overtimeHours ?? 0,
            nightHours: item?.nightHours ?? 0,
            holidayHours: item?.holidayHours ?? 0,
            absenceDays: item?.absenceDays ?? 0,
            status: PayslipStatus.DRAFT,
            journalEntryId: null,
            journalEntryNumber: null,
            issuedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }

        await this.hrRepository.createPayslips(tenantId, rows, manager);
        const sum = (key: keyof PayslipEntity): number =>
          rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
        Object.assign(run, {
          ratesYear: rates.year,
          employeeCount: rows.length,
          totalGross: sum('grossPay'),
          totalInsurable: sum('insurableWage'),
          totalEmployeeInsurance: sum('insuranceDeduction'),
          totalEmployerInsurance: sum('employerInsurance'),
          totalUnemploymentInsurance: sum('unemploymentInsurance'),
          totalIncomeTax: sum('incomeTax'),
          totalOtherDeductions: sum('otherDeductions'),
          totalNet: sum('netPay'),
          updatedAt: now,
        });
        await this.hrRepository.savePayrollRun(tenantId, run, manager);

        return { run, skipped };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `حقوق دوره ${dto.periodYear}/${dto.periodMonth} هم‌زمان توسط درخواست دیگری ساخته شد؛ دوباره تلاش کنید.`,
        );
      }
      throw error;
    }
    const { run, skipped } = saved;

    const payslips = await this.hrRepository.findPayslipsByRun(
      tenantId,
      run.id,
    );
    return this.toRunDto(run, payslips, skipped);
  }

  private async requireRun(
    tenantId: string,
    id: number,
  ): Promise<PayrollRunEntity> {
    const run = await this.hrRepository.findPayrollRunById(tenantId, id);
    if (!run) {
      throw new NotFoundException(`اجرای حقوق با شناسه ${id} یافت نشد.`);
    }
    return run;
  }

  async listRuns(tenantId: string): Promise<PayrollRunResponseDto[]> {
    const runs = await this.hrRepository.listPayrollRuns(tenantId);
    return runs.map((run) => this.toRunDto(run, []));
  }

  async findRun(tenantId: string, id: number): Promise<PayrollRunResponseDto> {
    const run = await this.requireRun(tenantId, id);
    const payslips = await this.hrRepository.findPayslipsByRun(tenantId, id);
    return this.toRunDto(run, payslips);
  }

  /** Balanced journal lines of a run (pure; exported for tests via the service). */
  buildJournalLines(run: PayrollRunEntity): JournalLine[] {
    const accounts = PAYROLL_RUN_ACCOUNTS;
    const employerCost =
      Number(run.totalEmployerInsurance) +
      Number(run.totalUnemploymentInsurance);
    const insurance = Number(run.totalEmployeeInsurance) + employerCost;
    const lines: JournalLine[] = [
      {
        accountCode: accounts.salaryExpense.code,
        debit: Number(run.totalGross),
        description: 'هزینه حقوق و دستمزد (ناخالص)',
      },
      {
        accountCode: accounts.employerInsuranceExpense.code,
        debit: employerCost,
        description: 'بیمه سهم کارفرما (۲۰٪) و بیمه بیکاری (۳٪)',
      },
      {
        accountCode: accounts.insurancePayable.code,
        credit: insurance,
        description: 'حق بیمه پرداختنی (۷٪ کارگر + ۲۳٪ کارفرما)',
      },
      {
        accountCode: accounts.wageTaxPayable.code,
        credit: Number(run.totalIncomeTax),
        description: 'مالیات حقوق پرداختنی',
      },
      {
        accountCode: accounts.otherDeductionsPayable.code,
        credit: Number(run.totalOtherDeductions),
        description: 'سایر کسورات حقوق',
      },
      {
        accountCode: accounts.salariesPayable.code,
        credit: Number(run.totalNet),
        description: 'خالص حقوق پرداختنی به کارکنان',
      },
    ];
    return lines.filter((line) => (line.debit ?? line.credit ?? 0) > 0);
  }

  /** Create the payroll ledger accounts the tenant does not have yet. */
  private async ensurePayrollAccounts(tenantId: string): Promise<void> {
    const existing = new Set(
      (await this.accountingService.listAccounts(tenantId)).map(
        (account) => account.code,
      ),
    );
    for (const account of Object.values(PAYROLL_RUN_ACCOUNTS)) {
      if (existing.has(account.code)) {
        continue;
      }
      await this.accountingService.createAccount(tenantId, {
        code: account.code,
        name: account.name,
        accountType:
          account.kind === 'EXPENSE'
            ? AccountType.EXPENSE
            : AccountType.LIABILITY,
      });
    }
  }

  /** Post a DRAFT run as one balanced journal entry and freeze it. */
  async postRun(tenantId: string, id: number): Promise<PayrollRunResponseDto> {
    const run = await this.requireRun(tenantId, id);
    if (run.status === PayrollRunStatus.POSTED) {
      throw new ConflictException(
        'این اجرای حقوق قبلاً در حسابداری ثبت شده است.',
      );
    }
    if (run.employeeCount <= 0 || Number(run.totalGross) <= 0) {
      throw new BadRequestException('اجرای حقوق فیش قابل ثبتی ندارد.');
    }

    await this.ensurePayrollAccounts(tenantId);
    const month = String(run.periodMonth).padStart(2, '0');
    const entryNumber = `${PAYROLL_RUN_ENTRY_PREFIX}-${run.periodYear}${month}`;

    // Journal entry + run/payslip status commit together. If an entry with this
    // number already exists for the tenant (e.g. a post that was interrupted
    // before the transaction fix), adopt it instead of failing on the duplicate.
    await this.hrRepository.runInTransaction(async (manager) => {
      const existing = await this.accountingService.findJournalEntryByNumber(
        tenantId,
        entryNumber,
      );
      const entry =
        existing ??
        (await this.accountingService.createJournalEntry(
          tenantId,
          {
            entryNumber,
            date: isoDate(jalaliMonthEnd(run.periodYear, run.periodMonth)),
            description: `سند حقوق و دستمزد ${run.periodYear}/${month} (${run.employeeCount} نفر)`,
            lines: this.buildJournalLines(run),
          },
          manager,
        ));

      const now = new Date();
      Object.assign(run, {
        status: PayrollRunStatus.POSTED,
        journalEntryId: entry.id,
        journalEntryNumber: entry.entryNumber,
        postedAt: now,
        updatedAt: now,
      });
      await this.hrRepository.savePayrollRun(tenantId, run, manager);
      await this.hrRepository.markRunPayslips(
        tenantId,
        run.id,
        {
          status: PayslipStatus.ISSUED,
          journalEntryId: entry.id,
          journalEntryNumber: entry.entryNumber,
          issuedAt: now,
        },
        manager,
      );
    });
    return this.findRun(tenantId, run.id);
  }

  /** SSO insurance list (DSKKAR00 + DSKWOR00) of a run. */
  async insuranceList(
    tenantId: string,
    id: number,
    query: InsuranceListQueryDto,
  ): Promise<InsuranceListResponseDto> {
    const run = await this.requireRun(tenantId, id);
    const rates = await this.requireRates(
      tenantId,
      run.ratesYear,
      run.periodMonth,
    );
    const payslips = await this.hrRepository.findPayslipsByRun(tenantId, id);
    const periodStart = isoDate(
      jalaliMonthStart(run.periodYear, run.periodMonth),
    );
    const periodEnd = isoDate(jalaliMonthEnd(run.periodYear, run.periodMonth));
    const inPeriod = (date: string | null | undefined): string =>
      date && date.slice(0, 10) >= periodStart && date.slice(0, 10) <= periodEnd
        ? compactJalali(date)
        : '';

    const workers: InsuranceListWorker[] = payslips
      .filter((payslip) => Number(payslip.insurableWage) > 0)
      .map((payslip) => {
        const employee = payslip.employee;
        return {
          insuranceNumber: employee.insuranceNumber ?? null,
          firstName: employee.firstName,
          lastName: employee.lastName,
          fatherName: employee.fatherName,
          nationalId: employee.nationalId,
          birthDate: compactJalali(employee.birthDate),
          gender: employee.gender,
          jobTitle: employee.jobTitle,
          startDate: inPeriod(employee.hireDate),
          endDate: inPeriod(employee.terminationDate),
          workDays: Number(payslip.workDays),
          dailyWage:
            (Number(payslip.baseSalary) + Number(payslip.seniorityAmount)) /
            rates.payrollMonthDays,
          insurableWage: Number(payslip.insurableWage),
          grossPay: Number(payslip.grossPay),
          employeeInsurance: Number(payslip.insuranceDeduction),
          employerInsurance: Number(payslip.employerInsurance),
          unemploymentInsurance: Number(payslip.unemploymentInsurance),
        };
      });

    return buildInsuranceList(
      {
        workshopCode: query.workshopCode,
        workshopName: query.workshopName,
        employerName: query.employerName,
        workshopAddress: query.workshopAddress,
        contractRow: query.contractRow,
        listNumber: query.listNumber,
      },
      run.periodYear,
      run.periodMonth,
      workers,
      Math.round(
        (rates.employerInsuranceRate + rates.unemploymentInsuranceRate) * 100,
      ),
    );
  }
}
