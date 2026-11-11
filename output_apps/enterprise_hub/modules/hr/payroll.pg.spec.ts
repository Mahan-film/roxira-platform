/**
 * Monthly payroll against a REAL PostgreSQL: migrations, entities, statutory store, cumulative tax
 * across posted months, journal lines and exports. Skipped unless ROXIRA_TEST_PG_HOST is set; each
 * run creates and drops its own database. Accounting is a fake that rejects unbalanced entries.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/hr/payroll.pg.spec.ts
 */
import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../access/services/audit.service';
import { AccountingService } from '../accounting/services/accounting.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { AllowanceTaxTreatment, Gender, LeaveType, MaritalStatus, PayrollRunStatus } from './enums/hr.enum';
import { HrRepository } from './repositories/hr.repository';
import { readDbf } from './services/dbf-file';
import { HrService } from './services/hr.service';
import { compareInsuranceTotals } from './services/insurance-list';
import { PayrollRunService } from './services/payroll-run.service';
import { StatutoryRepository } from './statutory/statutory.repository';
import { StatutoryService } from './statutory/statutory.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

const M = 1_000_000;

describePg('monthly payroll on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let repository: HrRepository;
  let hr: HrService;
  let runs: PayrollRunService;
  let employee: EmployeeEntity;
  const entries: { entryNumber: string; lines: { debit?: number; credit?: number }[] }[] = [];

  beforeAll(async () => {
    testDb = await createTestDatabase('payroll');

    repository = new HrRepository(testDb.scope, testDb.app);
    const accounting = {
      listAccounts: async () => [
        { code: '5010' },
        { code: '5040' },
        { code: '2030' },
        { code: '2040' },
        { code: '2060' },
        { code: '2050' },
        { code: '2010' },
        { code: '1010' },
      ],
      createAccount: async () => undefined,
      findJournalEntryByNumber: async () => null,
      createJournalEntry: async (
        _tenant: string,
        dto: {
          entryNumber: string;
          lines: {
            accountCode?: string;
            debit?: number | string;
            credit?: number | string;
          }[];
        },
      ) => {
        const lines = dto.lines.map((line) => ({
          accountCode: line.accountCode,
          debit: Number(line.debit ?? 0),
          credit: Number(line.credit ?? 0),
        }));
        const sum = (key: 'debit' | 'credit') =>
          lines.reduce((total, line) => total + line[key], 0);
        expect(sum('debit')).toBe(sum('credit'));
        entries.push({ entryNumber: dto.entryNumber, lines });
        const [row] = await testDb.rawQuery(
          `INSERT INTO fin_journal_entries (tenant_id, entry_number, description)
           VALUES ($1, $2, 'test') RETURNING id`,
          [T1, dto.entryNumber],
        );
        return { id: row.id, entryNumber: dto.entryNumber };
      },
    } as unknown as AccountingService;
    const statutory = new StatutoryService(
      new StatutoryRepository(testDb.scope),
      { record: async () => undefined } as unknown as AuditService,
    );
    const postingRules = new PostingRulesService(
      new PostingRulesRepository(testDb.scope),
      accounting,
    );
    hr = new HrService(repository, accounting, statutory, postingRules);
    runs = new PayrollRunService(
      repository,
      hr,
      accounting,
      statutory,
      postingRules,
    );

    const now = new Date();
    employee = await testDb.owner.getRepository(EmployeeEntity).save({
      tenantId: T1,
      employeeNumber: 'E1',
      firstName: 'مریم',
      lastName: 'کریمی',
      nationalId: '0012345679',
      gender: Gender.FEMALE,
      mobile: '09120000000',
      jobTitle: 'مدیر',
      department: 'مالی',
      maritalStatus: MaritalStatus.MARRIED,
      hireDate: '2026-03-21',
      insuranceNumber: '12345678',
      createdAt: now,
    });
    const contract = await testDb.owner.getRepository(EmploymentContractEntity).save({
      tenantId: T1,
      contractNumber: 'C1',
      employeeId: employee.id,
      startDate: '2026-03-21',
      jobTitle: 'مدیر',
      department: 'مالی',
      baseSalary: 900 * M,
      housingAllowance: 30 * M,
      foodAllowance: 22 * M,
      childAllowance: 0,
      insuranceRate: 0.07,
      createdAt: now,
      updatedAt: now,
    } as Partial<EmploymentContractEntity>);
    await repository.replaceAllowances(T1, contract.id, [
      { title: 'حق مسئولیت', amount: 50 * M, insurable: true, taxTreatment: AllowanceTaxTreatment.PROGRESSIVE },
    ]);
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('carries tax across posted months, balances, and exports totals that agree', async () => {
    const first = await runs.createOrRecalculate(T1, { periodYear: 1405, periodMonth: 1 });
    expect(first.employeeCount).toBe(1);
    const slip = first.payslips[0];
    expect(slip.monthDays).toBe(31);
    expect(slip.marriageAllowance).toBe(5 * M);
    expect(slip.allowancesTotal).toBe(50 * M);
    expect(first.unverifiedKeys).toContain('wage_tax_annual_brackets');
    await runs.postRun(T1, first.id);

    const second = await runs.createOrRecalculate(T1, { periodYear: 1405, periodMonth: 2 });
    await runs.postRun(T1, second.id);
    expect(entries).toHaveLength(2);
    expect(second.payslips[0].incomeTax).toBe(first.payslips[0].incomeTax);

    const third = await runs.createOrRecalculate(T1, {
      periodYear: 1405,
      periodMonth: 3,
      items: [{ employeeId: slip.employeeId, absenceDays: 10 }],
    });
    expect(third.payslips[0].workDays).toBe(21);
    expect(third.payslips[0].incomeTax).toBeLessThan(first.payslips[0].incomeTax);

    const list = await runs.insuranceList(T1, first.id, {
      workshopCode: '1234567890',
      workshopName: 'کارگاه',
      employerName: 'کارفرما',
    });
    const [kar] = readDbf(Buffer.from(list.workshopDbf, 'base64'));
    expect(compareInsuranceTotals(kar, readDbf(Buffer.from(list.workersDbf, 'base64')))).toEqual([]);
    expect(kar.DSK_TDD).toBe(31);

    const tax = await runs.wageTaxFiles(T1, first.id, {});
    expect(tax.totalTax).toBe(first.totalIncomeTax);
    expect(tax.uploadReady).toBe(false);
    expect(tax.wpFile).toContain('0012345679');
  });

  it('never exports another tenant run', async () => {
    const [run] = await runs.listRuns(T1);
    await expect(runs.wageTaxFiles(T2, run.id, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces FORCE RLS on attendances, leaves, staff loans and deductions as roxira_app role', async () => {
    // 0. Confirm NOSUPERUSER NOBYPASSRLS role
    const [roleRow] = await testDb.app.query(
      `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(roleRow.current_user).toBe('roxira_app');
    expect(roleRow.rolsuper).toBe(false);
    expect(roleRow.rolbypassrls).toBe(false);

    // 1. Record attendance for T1 through real repository & service as roxira_app role
    const attendance = await hr.recordAttendance(T1, {
      employeeId: employee.id,
      periodYear: 1405,
      periodMonth: 1,
      workDays: 30,
      overtimeHours: 12,
    });
    expect(attendance.id).toBeDefined();

    // Positive read as T1
    const t1Attendances = await hr.listAttendances(T1, {
      periodYear: 1405,
      periodMonth: 1,
    });
    expect(t1Attendances.length).toBeGreaterThan(0);
    expect(t1Attendances[0].id).toBe(attendance.id);

    // Cross-tenant check: T2 cannot see T1 attendance under RLS
    const t2Attendances = await hr.listAttendances(T2, {
      periodYear: 1405,
      periodMonth: 1,
    });
    expect(t2Attendances).toHaveLength(0);

    // 2. Request leave for T1
    const leave = await hr.requestLeave(T1, {
      employeeId: employee.id,
      leaveType: LeaveType.ANNUAL,
      startDate: '1405/01/10',
      endDate: '1405/01/12',
      days: 2,
    });
    expect(leave.id).toBeDefined();

    // Positive read as T1
    const t1Leaves = await hr.listLeaves(T1, {});
    expect(t1Leaves.length).toBeGreaterThan(0);
    expect(t1Leaves.find((l) => l.id === leave.id)).toBeDefined();

    // Cross-tenant check: T2 cannot see T1 leave
    const t2Leaves = await hr.listLeaves(T2, {});
    expect(t2Leaves).toHaveLength(0);

    // Wrong-tenant insert (WITH CHECK policy violation) must throw RLS error
    await expect(
      testDb.scope.run(T1, async () => {
        return testDb.app.query(
          `INSERT INTO hr_leaves (tenant_id, employee_id, leave_type, start_date, end_date, days, status)
           VALUES ($1, $2, 'ANNUAL', '1405/01/01', '1405/01/02', 1, 'PENDING')`,
          [T2, employee.id],
        );
      }),
    ).rejects.toThrow();

    // 3. Create staff loan for T1
    const loan = await hr.createStaffLoan(T1, {
      employeeId: employee.id,
      title: 'وام کارکنان',
      principalAmount: 20 * M,
      instalmentAmount: 5 * M,
      totalInstalments: 4,
      startDate: '1405/03/01',
    });
    expect(loan.id).toBeDefined();

    // Positive read as T1
    const t1Loans = await hr.listStaffLoans(T1, {});
    expect(t1Loans.length).toBeGreaterThan(0);
    expect(t1Loans.find((l) => l.id === loan.id)).toBeDefined();

    // Cross-tenant check: T2 cannot see T1 loan
    const t2Loans = await hr.listStaffLoans(T2, {});
    expect(t2Loans).toHaveLength(0);

    // 4. Calculate payroll on Postgres for month 3 (includes loan deduction)
    const run3 = await runs.createOrRecalculate(T1, {
      periodYear: 1405,
      periodMonth: 3,
    });
    expect(run3.id).toBeDefined();

    // Verify loan deduction row exists for T1
    const t1Deductions = await repository.findLoanDeductionsByRun(T1, run3.id);
    expect(t1Deductions).toHaveLength(1);
    expect(Number(t1Deductions[0].amount)).toBe(5 * M);
    expect(t1Deductions[0].status).toBe('PENDING');

    // Cross-tenant check: T2 cannot see T1 loan deductions
    const t2Deductions = await repository.findLoanDeductionsByRun(T2, run3.id);
    expect(t2Deductions).toHaveLength(0);

    // 5. Post the payroll run on Postgres
    const posted3 = await runs.postRun(T1, run3.id);
    expect(posted3.status).toBe(PayrollRunStatus.POSTED);

    // Verify loan remaining balance is atomically reduced on Postgres
    const updatedLoan = await repository.findStaffLoanById(T1, loan.id);
    expect(Number(updatedLoan?.remainingAmount)).toBe(15 * M);
    expect(updatedLoan?.paidInstalments).toBe(1);

    // Verify deduction status is updated to POSTED
    const postedDeductions = await repository.findLoanDeductionsByRun(T1, run3.id);
    expect(postedDeductions[0].status).toBe('POSTED');

    // 6. Double post must fail with 409 ConflictException
    await expect(runs.postRun(T1, run3.id)).rejects.toBeInstanceOf(ConflictException);
  });
});
