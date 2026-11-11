import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountingService } from '../accounting/services/accounting.service';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { PAYROLL_RUN_ACCOUNTS } from './constants/hr.constants';
import { HrController } from './controllers/hr.controller';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { PayrollRunEntity } from './entities/payroll-run.entity';
import { PayslipEntity } from './entities/payslip.entity';
import {
  ContractStatus,
  EmployeeStatus,
  Gender,
  PayrollRunStatus,
  PayslipStatus,
} from './enums/hr.enum';
import { HrRepository } from './repositories/hr.repository';
import { HrService } from './services/hr.service';
import { PayrollRunService } from './services/payroll-run.service';
import { reconcilePayrollRun } from './services/payroll-reconciliation';
import { fakeStatutory } from './statutory/__fixtures__/seeded-rates';
import { fakePostingRules } from './__fixtures__/fake-posting-rules';
import { isLeaveInPeriod } from './services/jalali-period';

/** Accounting fake: keeps a per-tenant chart and rejects unbalanced entries. */
class FakeAccountingService {
  accounts = new Map<string, Set<string>>();
  entries: {
    tenantId: string;
    entryNumber: string;
    lines: { accountCode: string; debit?: number; credit?: number }[];
  }[] = [];

  private chart(tenantId: string): Set<string> {
    if (!this.accounts.has(tenantId)) {
      this.accounts.set(tenantId, new Set(['1010', '2010', '5010']));
    }
    return this.accounts.get(tenantId)!;
  }

  async listAccounts(tenantId: string): Promise<{ code: string }[]> {
    return [...this.chart(tenantId)].map((code) => ({ code }));
  }

  async createAccount(
    tenantId: string,
    dto: { code: string },
  ): Promise<{ code: string }> {
    this.chart(tenantId).add(dto.code);
    return { code: dto.code };
  }

  async findJournalEntryByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<{ id: number; entryNumber: string } | null> {
    const index = this.entries.findIndex(
      (entry) => entry.tenantId === tenantId && entry.entryNumber === entryNumber,
    );
    return index === -1 ? null : { id: index + 1, entryNumber };
  }

  async createJournalEntry(
    tenantId: string,
    dto: {
      entryNumber: string;
      lines: {
        accountCode: string;
        debit?: number | string;
        credit?: number | string;
      }[];
    },
  ): Promise<{ id: number; entryNumber: string }> {
    const lines = dto.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: Number(line.debit ?? 0),
      credit: Number(line.credit ?? 0),
    }));
    const debit = lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (Math.abs(debit - credit) > 0.5) {
      throw new BadRequestException('unbalanced');
    }
    const chart = this.chart(tenantId);
    if (lines.some((line) => !chart.has(line.accountCode))) {
      throw new BadRequestException('missing account');
    }
    if (
      this.entries.some(
        (entry) =>
          entry.tenantId === tenantId && entry.entryNumber === dto.entryNumber,
      )
    ) {
      throw new ConflictException('duplicate entry');
    }
    this.entries.push({ tenantId, entryNumber: dto.entryNumber, lines });
    return { id: this.entries.length, entryNumber: dto.entryNumber };
  }
}

/** In-memory repository: every read and write is filtered by tenantId, like HrRepository. */
class InMemoryPayrollRepository {
  employees: EmployeeEntity[] = [];
  contracts: EmploymentContractEntity[] = [];
  payslips: PayslipEntity[] = [];
  runs: PayrollRunEntity[] = [];
  attendances: any[] = [];
  loans: any[] = [];
  loanDeductions: any[] = [];
  leaves: any[] = [];

  async findAttendanceByPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<any[]> {
    return this.attendances.filter(
      (a) =>
        a.tenantId === tenantId &&
        a.periodYear === periodYear &&
        a.periodMonth === periodMonth,
    );
  }

  async findApprovedLeavesForPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<any[]> {
    return this.leaves.filter(
      (l) =>
        l.tenantId === tenantId &&
        l.status === 'APPROVED' &&
        isLeaveInPeriod(l.startDate, l.endDate, periodYear, periodMonth),
    );
  }

  async hasPendingLoanDeductionsFromOtherRuns(
    tenantId: string,
    currentRunId: number,
  ): Promise<boolean> {
    return this.loanDeductions.some(
      (d) =>
        d.tenantId === tenantId &&
        d.payrollRunId !== currentRunId &&
        d.status === 'PENDING',
    );
  }

  async markLoanDeductionsPosted(
    tenantId: string,
    payrollRunId: number,
  ): Promise<void> {
    for (const d of this.loanDeductions) {
      if (d.tenantId === tenantId && d.payrollRunId === payrollRunId) {
        d.status = 'POSTED';
      }
    }
  }

  async deleteLoanDeductionsByRun(
    tenantId: string,
    payrollRunId: number,
  ): Promise<void> {
    this.loanDeductions = this.loanDeductions.filter(
      (d) => !(d.tenantId === tenantId && d.payrollRunId === payrollRunId),
    );
  }

  async createLoanDeductions(
    tenantId: string,
    rows: any[],
  ): Promise<void> {
    for (const r of rows) {
      this.loanDeductions.push({ ...r, tenantId });
    }
  }

  async findLoanDeductionsByRun(
    tenantId: string,
    payrollRunId: number,
  ): Promise<any[]> {
    return this.loanDeductions.filter(
      (d) => d.tenantId === tenantId && d.payrollRunId === payrollRunId,
    );
  }

  async applyLoanDeduction(
    tenantId: string,
    loanId: number,
    amount: any,
  ): Promise<any> {
    return this.deductLoanInstalment(tenantId, loanId, Number(amount));
  }

  async findActiveLoans(
    tenantId: string,
    employeeIds?: number[],
  ): Promise<any[]> {
    return this.loans.filter(
      (l) =>
        l.tenantId === tenantId &&
        l.status === 'ACTIVE' &&
        (!employeeIds || employeeIds.includes(l.employeeId)),
    );
  }

  async deductLoanInstalment(
    tenantId: string,
    loanId: number,
    amount: number,
  ): Promise<any> {
    const loan = this.loans.find((l) => l.tenantId === tenantId && l.id === loanId);
    if (!loan) return null;
    loan.paidInstalments = (loan.paidInstalments ?? 0) + 1;
    loan.remainingAmount = Math.max(0, (loan.remainingAmount ?? 0) - amount);
    if (loan.remainingAmount <= 0) loan.status = 'PAID_OFF';
    return loan;
  }
  private seq = 0;

  nextId(): number {
    return ++this.seq;
  }

  /** Mimics a DB transaction: on throw, runs/payslips are restored to the pre-transaction state. */
  async runInTransaction<T>(work: (manager: undefined) => Promise<T>): Promise<T> {
    const runs = this.runs.map((row) => ({ ...row }));
    const payslips = [...this.payslips];
    try {
      return await work(undefined);
    } catch (error) {
      this.runs = runs;
      this.payslips = payslips;
      throw error;
    }
  }

  async findActiveEmployees(tenantId: string): Promise<EmployeeEntity[]> {
    return this.employees.filter(
      (row) =>
        row.tenantId === tenantId && row.status === EmployeeStatus.ACTIVE,
    );
  }

  async findActiveContractsByEmployeeIds(
    tenantId: string,
    ids: number[],
  ): Promise<EmploymentContractEntity[]> {
    return this.contracts.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.status === ContractStatus.ACTIVE &&
        ids.includes(row.employeeId),
    );
  }

  async findAllowancesByContractIds(): Promise<never[]> {
    return [];
  }

  async findIssuedPayslipsBefore(
    tenantId: string,
    employeeIds: number[],
    periodYear: number,
    beforeMonth: number,
  ): Promise<PayslipEntity[]> {
    return this.payslips.filter(
      (slip) =>
        slip.tenantId === tenantId &&
        employeeIds.includes(slip.employeeId) &&
        slip.periodYear === periodYear &&
        slip.periodMonth < beforeMonth &&
        slip.status !== PayslipStatus.DRAFT,
    );
  }

  async findPayrollRunsOfYear(
    tenantId: string,
    periodYear: number,
  ): Promise<PayrollRunEntity[]> {
    return this.runs.filter(
      (run) => run.tenantId === tenantId && run.periodYear === periodYear,
    );
  }

  async findPayslipsOfPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayslipEntity[]> {
    return this.payslips.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.periodYear === periodYear &&
        row.periodMonth === periodMonth,
    );
  }

  async findPayrollRunById(
    tenantId: string,
    id: number,
  ): Promise<PayrollRunEntity | null> {
    return (
      this.runs.find((row) => row.id === id && row.tenantId === tenantId) ??
      null
    );
  }

  async findPayrollRunByIdForUpdate(
    tenantId: string,
    id: number,
  ): Promise<PayrollRunEntity | null> {
    return this.findPayrollRunById(tenantId, id);
  }

  async findPayrollRunByPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayrollRunEntity | null> {
    return (
      this.runs.find(
        (row) =>
          row.tenantId === tenantId &&
          row.periodYear === periodYear &&
          row.periodMonth === periodMonth,
      ) ?? null
    );
  }

  async listPayrollRuns(tenantId: string): Promise<PayrollRunEntity[]> {
    return this.runs.filter((row) => row.tenantId === tenantId);
  }

  async createPayrollRun(
    tenantId: string,
    data: Partial<PayrollRunEntity>,
  ): Promise<PayrollRunEntity> {
    const run = {
      employeeCount: 0,
      totalGross: 0,
      journalEntryId: null,
      journalEntryNumber: null,
      postedAt: null,
      ...data,
      id: this.nextId(),
      tenantId,
    } as PayrollRunEntity;
    this.runs.push(run);
    return run;
  }

  async savePayrollRun(
    tenantId: string,
    entity: PayrollRunEntity,
  ): Promise<PayrollRunEntity> {
    const index = this.runs.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index !== -1) {
      this.runs[index] = { ...entity, tenantId };
    }
    return entity;
  }

  async findPayslipsByRun(
    tenantId: string,
    runId: number,
  ): Promise<PayslipEntity[]> {
    return this.payslips
      .filter((row) => row.tenantId === tenantId && row.payrollRunId === runId)
      .map((row) => ({
        ...row,
        employee: this.employees.find(
          (employee) =>
            employee.id === row.employeeId && employee.tenantId === tenantId,
        )!,
      }));
  }

  async createPayslips(
    tenantId: string,
    rows: Partial<PayslipEntity>[],
  ): Promise<PayslipEntity[]> {
    const created = rows.map(
      (row) => ({ ...row, id: this.nextId(), tenantId }) as PayslipEntity,
    );
    this.payslips.push(...created);
    return created;
  }

  async deletePayslipsByRun(tenantId: string, runId: number): Promise<number> {
    const before = this.payslips.length;
    this.payslips = this.payslips.filter(
      (row) => !(row.tenantId === tenantId && row.payrollRunId === runId),
    );
    return before - this.payslips.length;
  }

  async markRunPayslips(
    tenantId: string,
    runId: number,
    changes: Partial<PayslipEntity>,
  ): Promise<void> {
    this.payslips = this.payslips.map((row) =>
      row.tenantId === tenantId && row.payrollRunId === runId
        ? { ...row, ...changes }
        : row,
    );
  }

  seedEmployee(
    tenantId: string,
    overrides: Partial<EmployeeEntity> = {},
    baseSalary = 166_255_500,
  ): EmployeeEntity {
    const employee = {
      id: this.nextId(),
      tenantId,
      employeeNumber: `EMP-${this.seq}`,
      firstName: 'کارمند',
      lastName: String(this.seq),
      nationalId: String(1_000_000_000 + this.seq),
      fatherName: null,
      birthDate: '1990-03-21',
      gender: Gender.MALE,
      jobTitle: 'کارشناس',
      department: 'مالی',
      dependants: 0,
      status: EmployeeStatus.ACTIVE,
      hireDate: '2024-03-20',
      terminationDate: null,
      insuranceNumber: '0012345678',
      ...overrides,
    } as EmployeeEntity;
    this.employees.push(employee);
    this.contracts.push({
      id: this.nextId(),
      tenantId,
      employeeId: employee.id,
      status: ContractStatus.ACTIVE,
      baseSalary,
      housingAllowance: 30_000_000,
      foodAllowance: 22_000_000,
      childAllowance: 0,
      insuranceRate: 0.07,
      isInsuranceSubject: true,
      startDate: '2024-03-20',
    } as EmploymentContractEntity);
    return employee;
  }
}

const setup = () => {
  const repo = new InMemoryPayrollRepository();
  const accounting = new FakeAccountingService();
  const postingRules = fakePostingRules(
    accounting as unknown as AccountingService,
  );
  const hrService = new HrService(
    repo as unknown as HrRepository,
    accounting as unknown as AccountingService,
    fakeStatutory(),
    postingRules,
  );
  const service = new PayrollRunService(
    repo as unknown as HrRepository,
    hrService,
    accounting as unknown as AccountingService,
    fakeStatutory(),
    postingRules,
  );
  return { repo, accounting, hrService, service };
};

const period = { periodYear: 1405, periodMonth: 7 };
const workshop = {
  workshopCode: '1234567890',
  workshopName: 'کارگاه',
  employerName: 'کارفرما',
};

describe('PayrollRunService — calculation and posting', () => {
  it('calculates a draft run for the tenant active employees only', async () => {
    const { repo, service } = setup();
    const a1 = repo.seedEmployee('tenant-a');
    repo.seedEmployee('tenant-a', { dependants: 2 });
    repo.seedEmployee('tenant-a', { status: EmployeeStatus.TERMINATED });
    const b1 = repo.seedEmployee('tenant-b');

    const run = await service.createOrRecalculate('tenant-a', {
      ...period,
      items: [
        { employeeId: a1.id, overtimeHours: 10 },
        // Another tenant's employee id is ignored, never calculated.
        { employeeId: b1.id, overtimeHours: 99 },
      ],
    });

    expect(run.status).toBe(PayrollRunStatus.DRAFT);
    expect(run.employeeCount).toBe(2);
    expect(run.payslips.map((p) => p.employeeId)).not.toContain(b1.id);
    const first = run.payslips.find((p) => p.employeeId === a1.id)!;
    expect(first.overtimeHours).toBe(10);
    expect(first.overtimeAmount).toBeGreaterThan(0);
    expect(first.seniorityAmount).toBe(166_667 * 30 * 2);
    expect(first.status).toBe(PayslipStatus.DRAFT);
    expect(run.totalNet).toBe(
      run.totalGross -
        run.totalEmployeeInsurance -
        run.totalIncomeTax -
        run.totalOtherDeductions,
    );
    expect(repo.payslips.every((p) => p.tenantId === 'tenant-a')).toBe(true);
  });

  it('recalculates a draft run in place without duplicate payslips', async () => {
    const { repo, service } = setup();
    const a1 = repo.seedEmployee('tenant-a');
    const first = await service.createOrRecalculate('tenant-a', period);
    const second = await service.createOrRecalculate('tenant-a', {
      ...period,
      items: [{ employeeId: a1.id, absenceDays: 2 }],
    });
    expect(second.id).toBe(first.id);
    expect(repo.payslips).toHaveLength(1);
    expect(second.payslips[0].workDays).toBe(28);
    expect(second.totalGross).toBeLessThan(first.totalGross);
  });

  it('posts one balanced journal entry in the same tenant and freezes the run', async () => {
    const { repo, accounting, service } = setup();
    repo.seedEmployee('tenant-a', { dependants: 1 });
    repo.seedEmployee('tenant-a');
    const draft = await service.createOrRecalculate('tenant-a', period);

    const posted = await service.postRun('tenant-a', draft.id);

    expect(posted.status).toBe(PayrollRunStatus.POSTED);
    expect(posted.journalEntryNumber).toBe('PR-140507');
    expect(
      posted.payslips.every((p) => p.status === PayslipStatus.ISSUED),
    ).toBe(true);
    expect(accounting.entries).toHaveLength(1);
    const entry = accounting.entries[0];
    expect(entry.tenantId).toBe('tenant-a');
    const debit = entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(
      posted.totalGross +
        posted.totalEmployerInsurance +
        posted.totalUnemploymentInsurance,
    );
    const insuranceLine = entry.lines.find(
      (l) => l.accountCode === PAYROLL_RUN_ACCOUNTS.insurancePayable.code,
    )!;
    expect(insuranceLine.credit).toBe(
      posted.totalEmployeeInsurance +
        posted.totalEmployerInsurance +
        posted.totalUnemploymentInsurance,
    );
    // Payroll accounts were created in tenant A's chart only.
    expect(accounting.accounts.get('tenant-a')!.has('2030')).toBe(true);
    expect(accounting.accounts.get('tenant-b')).toBeUndefined();

    await expect(service.postRun('tenant-a', draft.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.createOrRecalculate('tenant-a', period),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('adopts an existing PR-YYYYMM entry instead of failing on the duplicate', async () => {
    const { repo, accounting, service } = setup();
    repo.seedEmployee('tenant-a');
    const draft = await service.createOrRecalculate('tenant-a', period);
    accounting.entries.push({ tenantId: 'tenant-a', entryNumber: 'PR-140507', lines: [] });

    const posted = await service.postRun('tenant-a', draft.id);

    expect(posted.status).toBe(PayrollRunStatus.POSTED);
    expect(posted.journalEntryNumber).toBe('PR-140507');
    expect(posted.journalEntryId).toBe(1);
    expect(accounting.entries).toHaveLength(1);
  });

  it('postRun leaves the run a DRAFT when journal creation fails', async () => {
    const { repo, accounting, service } = setup();
    repo.seedEmployee('tenant-a');
    const draft = await service.createOrRecalculate('tenant-a', period);
    jest
      .spyOn(accounting, 'createJournalEntry')
      .mockRejectedValueOnce(new BadRequestException('boom'));

    await expect(service.postRun('tenant-a', draft.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await service.findRun('tenant-a', draft.id)).status).toBe(
      PayrollRunStatus.DRAFT,
    );
  });

  it('a failed recalculation rolls back run and payslips', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    jest
      .spyOn(repo, 'createPayslips')
      .mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.createOrRecalculate('tenant-a', period),
    ).rejects.toThrow('db down');
    expect(repo.runs).toHaveLength(0);
    expect(repo.payslips).toHaveLength(0);
  });

  it('reports each unverified value, not a blanket flag', async () => {
    const { service } = setup();
    const rates = await service.getRates('tenant-a', 1405);
    expect(rates.verified).toBe(false);
    expect(rates.unverifiedKeys).toContain('wage_tax_annual_brackets');
    expect(rates.unverifiedKeys).not.toContain('min_daily_wage');
  });

  it('refuses a year without configured rates', async () => {
    const { service } = setup();
    await expect(
      service.createOrRecalculate('tenant-a', {
        periodYear: 1399,
        periodMonth: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds the insurance list from the run payslips', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    repo.seedEmployee('tenant-a', { insuranceNumber: null });
    const run = await service.createOrRecalculate('tenant-a', period);

    const list = await service.insuranceList('tenant-a', run.id, workshop);

    expect(list.workshopFileName).toBe('DSKKAR00.csv');
    expect(list.workersFile.trim().split('\r\n')).toHaveLength(3);
    expect(list.workshopFile).toContain(
      `,${run.totalEmployeeInsurance},${run.totalEmployerInsurance},${run.totalUnemploymentInsurance},23,`,
    );
    expect(list.warnings).toHaveLength(1);
  });

  it('PAY-02: the posted voucher reconciles to the run totals and the payslips', async () => {
    const { repo, accounting, service } = setup();
    repo.seedEmployee('tenant-a', { dependants: 1 });
    repo.seedEmployee('tenant-a');
    repo.seedEmployee('tenant-a');
    const draft = await service.createOrRecalculate('tenant-a', period);
    const posted = await service.postRun('tenant-a', draft.id);

    // The lines that went to the ledger, not a rebuild of them.
    const entry = accounting.entries[0];
    const codes = PAYROLL_RUN_ACCOUNTS;
    const result = reconcilePayrollRun(
      posted,
      posted.payslips,
      entry.lines,
      {
        salaryExpense: codes.salaryExpense.code,
        employerInsuranceExpense: codes.employerInsuranceExpense.code,
        insurancePayable: codes.insurancePayable.code,
        wageTaxPayable: codes.wageTaxPayable.code,
        otherDeductionsPayable: codes.otherDeductionsPayable.code,
        salariesPayable: codes.salariesPayable.code,
      },
    );
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.debitTotal).toBe(
      posted.totalGross + posted.totalEmployerInsurance + posted.totalUnemploymentInsurance,
    );
    expect((await service.reconciliation('tenant-a', posted.id)).ok).toBe(true);
    await expect(service.reconciliation('tenant-b', posted.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('PAY-02: reconciliation names a total that was changed after the payslips were written', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    const run = await service.createOrRecalculate('tenant-a', period);
    repo.runs[0].totalNet = Number(repo.runs[0].totalNet) + 1;

    const result = await service.reconciliation('tenant-a', run.id);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('totalNet vs payslips');
  });

  it('PAY-02: renders a Persian payslip PDF per employee, only for the own tenant', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    repo.seedEmployee('tenant-a');
    const run = await service.createOrRecalculate('tenant-a', period);

    const all = await service.payslipsPdf('tenant-a', run.id);
    expect(all.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(all.filename).toBe('payslips-140507.pdf');
    const one = await service.payslipsPdf('tenant-a', run.id, run.payslips[0].id);
    expect(one.body.length).toBeLessThan(all.body.length);

    await expect(service.payslipsPdf('tenant-b', run.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.payslipsPdf('tenant-a', run.id, 999_999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PayrollRunService — cross-tenant isolation', () => {
  const seededRun = async () => {
    const ctx = setup();
    ctx.repo.seedEmployee('tenant-a');
    const run = await ctx.service.createOrRecalculate('tenant-a', period);
    return { ...ctx, run };
  };

  it('does not read, list, post or export another tenant run (404)', async () => {
    const { service, accounting, run } = await seededRun();

    await expect(service.findRun('tenant-b', run.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.postRun('tenant-b', run.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.insuranceList('tenant-b', run.id, workshop),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.listRuns('tenant-b')).toEqual([]);
    expect(accounting.entries).toHaveLength(0);
  });

  it('lets two tenants run the same period independently', async () => {
    const { repo, service } = await seededRun();
    repo.seedEmployee('tenant-b');
    const runB = await service.createOrRecalculate('tenant-b', period);
    expect(runB.employeeCount).toBe(1);
    expect(await service.listRuns('tenant-a')).toHaveLength(1);
  });
});

describe('HrController — payroll runs use the JWT tenant only', () => {
  const requestWith = (user: unknown): AuthenticatedRequest =>
    ({ user }) as unknown as AuthenticatedRequest;

  it('routes calls with the token tenant only', async () => {
    const { repo, hrService, service } = setup();
    repo.seedEmployee('tenant-a');
    const controller = new HrController(hrService, service);

    const run = await controller.createPayrollRun(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      period,
    );
    expect(run.employeeCount).toBe(1);

    await expect(
      controller.getPayrollRun(
        requestWith({ tenantId: 'tenant-b', role: UserRole.ADMIN }),
        run.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** A TenantScope whose manager hands out the given mock repositories by entity class name. */
const fakeScope = (repos: Record<string, unknown>) =>
  ({
    within: (_t: string, _m: unknown, fn: (m: unknown) => unknown) =>
      fn({ getRepository: (e: { name: string }) => repos[e.name] ?? {} }),
  }) as never;

describe('HrRepository — payroll-run queries are tenant scoped', () => {
  const build = () => {
    const payslips = {
      find: jest.fn(async () => []),
      delete: jest.fn(async () => ({ affected: 0 })),
      update: jest.fn(async () => ({ affected: 0 })),
    };
    const runs = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      update: jest.fn(async () => ({ affected: 0 })),
    };
    const repository = new HrRepository(fakeScope({ PayslipEntity: payslips, PayrollRunEntity: runs }), {} as never);
    return { repository, payslips, runs };
  };

  it('scopes run lookups, updates and payslip deletes by tenantId', async () => {
    const { repository, payslips, runs } = build();

    await repository.findPayrollRunById('tenant-a', 5);
    expect(runs.findOne).toHaveBeenCalledWith({
      where: { id: 5, tenantId: 'tenant-a' },
    });

    await repository.savePayrollRun('tenant-a', {
      id: 5,
      tenantId: 'tenant-b',
    } as PayrollRunEntity);
    expect(runs.update).toHaveBeenCalledWith(
      { id: 5, tenantId: 'tenant-a' },
      expect.any(Object),
    );

    await repository.deletePayslipsByRun('tenant-a', 5);
    expect(payslips.delete).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      payrollRunId: 5,
    });

    await repository.markRunPayslips('tenant-a', 5, {
      status: PayslipStatus.ISSUED,
      journalEntryId: 1,
      journalEntryNumber: 'PR-140507',
      issuedAt: new Date(),
    });
    expect(payslips.update).toHaveBeenCalledWith(
      { tenantId: 'tenant-a', payrollRunId: 5 },
      expect.any(Object),
    );
  });
});

describe('PayrollRunService — month order and cumulative tax', () => {
  const nextMonth = { periodYear: period.periodYear, periodMonth: period.periodMonth + 1 };

  it('refuses a month while an earlier month is still a draft', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    await service.createOrRecalculate('tenant-a', period);
    await expect(service.createOrRecalculate('tenant-a', nextMonth)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a month before a posted one', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    const later = await service.createOrRecalculate('tenant-a', nextMonth);
    await service.postRun('tenant-a', later.id);
    await expect(service.createOrRecalculate('tenant-a', period)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('carries earlier posted months into the next run and stores the rates used', async () => {
    const { repo, service } = setup();
    repo.seedEmployee('tenant-a');
    const first = await service.createOrRecalculate('tenant-a', period);
    await service.postRun('tenant-a', first.id);
    const second = await service.createOrRecalculate('tenant-a', nextMonth);
    expect(second.unverifiedKeys).toContain('wage_tax_annual_brackets');
    expect(repo.runs.find((run) => run.id === second.id)?.ratesSnapshot?.year).toBe(period.periodYear);
    expect(second.totalIncomeTax).toBeGreaterThanOrEqual(0);
  });
});
