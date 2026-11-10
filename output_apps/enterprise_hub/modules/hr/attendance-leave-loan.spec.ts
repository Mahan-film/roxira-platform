import 'reflect-metadata';
import { EmployeeStatus, ContractStatus, LeaveType, LeaveStatus, LoanStatus, MaritalStatus, Gender } from './enums/hr.enum';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { EmployeeAttendanceEntity } from './entities/employee-attendance.entity';
import { EmployeeLeaveEntity } from './entities/employee-leave.entity';
import { StaffLoanEntity } from './entities/staff-loan.entity';
import { PayrollRunEntity } from './entities/payroll-run.entity';
import { PayslipEntity } from './entities/payslip.entity';
import { HrService } from './services/hr.service';
import { PayrollRunService } from './services/payroll-run.service';
import { fakeStatutory } from './statutory/__fixtures__/seeded-rates';
import { fakePostingRules } from './__fixtures__/fake-posting-rules';

const T1 = '11111111-1111-4111-8111-111111111111';

class FakeAccountingService {
  async listAccounts(): Promise<{ code: string }[]> {
    return [{ code: '5010' }, { code: '5040' }, { code: '2030' }, { code: '2040' }, { code: '2060' }, { code: '2050' }, { code: '2010' }, { code: '1010' }];
  }
  async createAccount(): Promise<void> {}
  async findJournalEntryByNumber(): Promise<null> {
    return null;
  }
  async createJournalEntry(tenantId: string, dto: any): Promise<{ id: number; entryNumber: string }> {
    return { id: 1, entryNumber: dto.entryNumber };
  }
}

class TestHrRepository {
  employees: EmployeeEntity[] = [];
  contracts: EmploymentContractEntity[] = [];
  attendances: EmployeeAttendanceEntity[] = [];
  leaves: EmployeeLeaveEntity[] = [];
  loans: StaffLoanEntity[] = [];
  payslips: PayslipEntity[] = [];
  runs: PayrollRunEntity[] = [];
  private seq = 0;

  async runInTransaction<T>(work: (manager: undefined) => Promise<T>): Promise<T> {
    return work(undefined);
  }

  async findEmployeeById(tenantId: string, id: number): Promise<EmployeeEntity | null> {
    return this.employees.find((e) => e.tenantId === tenantId && e.id === id) ?? null;
  }

  async findActiveEmployees(tenantId: string): Promise<EmployeeEntity[]> {
    return this.employees.filter((e) => e.tenantId === tenantId && e.status === EmployeeStatus.ACTIVE);
  }

  async findActiveContractsByEmployeeIds(tenantId: string, ids: number[]): Promise<EmploymentContractEntity[]> {
    return this.contracts.filter(
      (c) => c.tenantId === tenantId && c.status === ContractStatus.ACTIVE && ids.includes(c.employeeId),
    );
  }

  async findAllowancesByContractIds(): Promise<never[]> {
    return [];
  }

  async findIssuedPayslipsBefore(): Promise<never[]> {
    return [];
  }

  async findPayslipsOfPeriod(): Promise<never[]> {
    return [];
  }

  async findPayrollRunByPeriod(tenantId: string, year: number, month: number): Promise<PayrollRunEntity | null> {
    return this.runs.find((r) => r.tenantId === tenantId && r.periodYear === year && r.periodMonth === month) ?? null;
  }

  async findPayrollRunsOfYear(tenantId: string, year: number): Promise<PayrollRunEntity[]> {
    return this.runs.filter((r) => r.tenantId === tenantId && r.periodYear === year);
  }

  async findPayrollRunById(tenantId: string, id: number): Promise<PayrollRunEntity | null> {
    return this.runs.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }

  async createPayrollRun(tenantId: string, data: Partial<PayrollRunEntity>): Promise<PayrollRunEntity> {
    const run = { ...data, id: ++this.seq, tenantId } as PayrollRunEntity;
    this.runs.push(run);
    return run;
  }

  async savePayrollRun(tenantId: string, run: PayrollRunEntity): Promise<PayrollRunEntity> {
    return run;
  }

  async deletePayslipsByRun(tenantId: string, runId: number): Promise<void> {
    this.payslips = this.payslips.filter((p) => !(p.tenantId === tenantId && p.payrollRunId === runId));
  }

  async createPayslips(tenantId: string, rows: Partial<PayslipEntity>[]): Promise<void> {
    for (const row of rows) {
      const p = { ...row, id: ++this.seq, tenantId } as PayslipEntity;
      this.payslips.push(p);
    }
  }

  async findPayslipsByRun(tenantId: string, runId: number): Promise<PayslipEntity[]> {
    return this.payslips.filter((p) => p.tenantId === tenantId && p.payrollRunId === runId);
  }

  async markRunPayslips(tenantId: string, runId: number, changes: any): Promise<void> {
    for (const p of this.payslips) {
      if (p.tenantId === tenantId && p.payrollRunId === runId) {
        Object.assign(p, changes);
      }
    }
  }

  // Attendance
  async saveAttendance(tenantId: string, data: Partial<EmployeeAttendanceEntity>): Promise<EmployeeAttendanceEntity> {
    const existing = this.attendances.find(
      (a) => a.tenantId === tenantId && a.employeeId === data.employeeId && a.periodYear === data.periodYear && a.periodMonth === data.periodMonth,
    );
    if (existing) {
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    }
    const created = {
      ...data,
      id: ++this.seq,
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EmployeeAttendanceEntity;
    this.attendances.push(created);
    return created;
  }

  async findAttendanceByPeriod(tenantId: string, year: number, month: number): Promise<EmployeeAttendanceEntity[]> {
    return this.attendances.filter((a) => a.tenantId === tenantId && a.periodYear === year && a.periodMonth === month);
  }

  async findEmployeeAttendance(tenantId: string, employeeId: number, year: number, month: number): Promise<EmployeeAttendanceEntity | null> {
    return this.attendances.find(
      (a) => a.tenantId === tenantId && a.employeeId === employeeId && a.periodYear === year && a.periodMonth === month,
    ) ?? null;
  }

  async listAttendances(tenantId: string, query: any): Promise<EmployeeAttendanceEntity[]> {
    return this.attendances.filter((a) => {
      if (a.tenantId !== tenantId) return false;
      if (query.employeeId && a.employeeId !== query.employeeId) return false;
      if (query.periodYear && a.periodYear !== query.periodYear) return false;
      if (query.periodMonth && a.periodMonth !== query.periodMonth) return false;
      return true;
    });
  }

  // Leaves
  async createLeave(tenantId: string, data: Partial<EmployeeLeaveEntity>): Promise<EmployeeLeaveEntity> {
    const leave = {
      ...data,
      id: ++this.seq,
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EmployeeLeaveEntity;
    this.leaves.push(leave);
    return leave;
  }

  async findLeaveById(tenantId: string, id: number): Promise<EmployeeLeaveEntity | null> {
    return this.leaves.find((l) => l.tenantId === tenantId && l.id === id) ?? null;
  }

  async updateLeave(tenantId: string, id: number, changes: Partial<EmployeeLeaveEntity>): Promise<EmployeeLeaveEntity> {
    const leave = await this.findLeaveById(tenantId, id);
    if (!leave) throw new Error('Not found');
    Object.assign(leave, changes, { updatedAt: new Date() });
    return leave;
  }

  async listLeaves(tenantId: string, query: any): Promise<EmployeeLeaveEntity[]> {
    return this.leaves.filter((l) => {
      if (l.tenantId !== tenantId) return false;
      if (query.employeeId && l.employeeId !== query.employeeId) return false;
      if (query.status && l.status !== query.status) return false;
      return true;
    });
  }

  // Staff Loans
  async createStaffLoan(tenantId: string, data: Partial<StaffLoanEntity>): Promise<StaffLoanEntity> {
    const loan = {
      ...data,
      id: ++this.seq,
      tenantId,
      paidInstalments: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as StaffLoanEntity;
    this.loans.push(loan);
    return loan;
  }

  async findStaffLoanById(tenantId: string, id: number): Promise<StaffLoanEntity | null> {
    return this.loans.find((l) => l.tenantId === tenantId && l.id === id) ?? null;
  }

  async findActiveLoans(tenantId: string, employeeIds?: number[]): Promise<StaffLoanEntity[]> {
    return this.loans.filter((l) => {
      if (l.tenantId !== tenantId) return false;
      if (l.status !== LoanStatus.ACTIVE) return false;
      if (employeeIds && !employeeIds.includes(l.employeeId)) return false;
      return true;
    });
  }

  async listStaffLoans(tenantId: string, query: any): Promise<StaffLoanEntity[]> {
    return this.loans.filter((l) => {
      if (l.tenantId !== tenantId) return false;
      if (query.employeeId && l.employeeId !== query.employeeId) return false;
      if (query.status && l.status !== query.status) return false;
      return true;
    });
  }

  async deductLoanInstalment(tenantId: string, loanId: number, amount: number): Promise<StaffLoanEntity | null> {
    const loan = await this.findStaffLoanById(tenantId, loanId);
    if (!loan || loan.status !== LoanStatus.ACTIVE) return null;
    loan.paidInstalments += 1;
    loan.remainingAmount = Math.max(0, Number(loan.remainingAmount) - amount);
    if (loan.remainingAmount <= 0 || loan.paidInstalments >= loan.totalInstalments) {
      loan.status = LoanStatus.PAID_OFF;
    }
    loan.updatedAt = new Date();
    return loan;
  }
}

describe('T67: Leave, attendance and staff loan integration with payroll', () => {
  let repository: TestHrRepository;
  let hrService: HrService;
  let payrollRunService: PayrollRunService;
  let employee: EmployeeEntity;
  let contract: EmploymentContractEntity;

  beforeEach(async () => {
    repository = new TestHrRepository();
    const statutory = fakeStatutory();
    const accounting = new FakeAccountingService();
    const postingRules = fakePostingRules(accounting as any);

    hrService = new HrService(
      repository as any,
      accounting as any,
      postingRules as any,
      statutory as any,
    );
    payrollRunService = new PayrollRunService(
      repository as any,
      hrService,
      accounting as any,
      statutory as any,
      postingRules as any,
    );

    employee = {
      id: 101,
      tenantId: T1,
      employeeNumber: 'EMP-101',
      firstName: 'حمید',
      lastName: 'رضایی',
      nationalId: '0012345678',
      fatherName: 'علی',
      birthDate: '1370-01-01',
      gender: Gender.MALE,
      maritalStatus: MaritalStatus.MARRIED,
      dependants: 1,
      hireDate: '1400-01-01',
      status: EmployeeStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as EmployeeEntity;
    repository.employees.push(employee);

    contract = {
      id: 201,
      tenantId: T1,
      employeeId: employee.id,
      contractNumber: 'CTR-201',
      baseSalary: 100_000_000,
      housingAllowance: 9_000_000,
      foodAllowance: 14_000_000,
      childAllowance: 0,
      isInsuranceSubject: true,
      insuranceRate: null,
      status: ContractStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as EmploymentContractEntity;
    repository.contracts.push(contract);
  });

  describe('1. Attendance & Monthly Timesheet', () => {
    it('records attendance and automatically feeds into payroll-run payslips', async () => {
      // 1. Record monthly attendance for 1405/01:
      // 10 hours overtime, 5 hours night shift, 8 hours holiday, 2 days unpaid absence
      await hrService.recordAttendance(T1, {
        employeeId: employee.id,
        periodYear: 1405,
        periodMonth: 1,
        workDays: 29,
        overtimeHours: 10,
        nightHours: 5,
        holidayHours: 8,
        absenceDays: 2,
        notes: 'حضور عادی همراه با اضافه‌کاری پروژه',
      });

      // 2. Run payroll WITHOUT providing item overrides
      const run = await payrollRunService.createOrRecalculate(T1, {
        periodYear: 1405,
        periodMonth: 1,
      });

      expect(run.employeeCount).toBe(1);
      const payslip = run.payslips[0];
      expect(payslip).toBeDefined();

      // Asserts that monthly attendance fed into payslip automatically
      expect(payslip.overtimeHours).toBe(10);
      expect(payslip.nightHours).toBe(5);
      expect(payslip.holidayHours).toBe(8);
      expect(payslip.absenceDays).toBe(2);

      // Verify that statutory rates calculate the monetary lines correctly (> 0)
      expect(payslip.overtimeAmount).toBeGreaterThan(0);
      expect(payslip.nightShiftAmount).toBeGreaterThan(0);
      expect(payslip.holidayAmount).toBeGreaterThan(0);
      expect(payslip.absenceDeduction).toBeGreaterThan(0);
    });

    it('combines unpaid leave days with absence days when attendance records unpaid leave', async () => {
      await hrService.recordAttendance(T1, {
        employeeId: employee.id,
        periodYear: 1405,
        periodMonth: 1,
        absenceDays: 1,
        unpaidLeaveDays: 2,
      });

      const run = await payrollRunService.createOrRecalculate(T1, {
        periodYear: 1405,
        periodMonth: 1,
      });

      const payslip = run.payslips[0];
      // total absence = 1 day absence + 2 days unpaid leave = 3 days
      expect(payslip.absenceDays).toBe(3);
      expect(payslip.absenceDeduction).toBeGreaterThan(0);
    });
  });

  describe('2. Staff Loans & Auto Deduction from Payslips', () => {
    it('automatically deducts active loan instalments from payslip and updates balance on postRun', async () => {
      // 1. Create a staff loan: 12,000,000 rials in 12 instalments of 1,000,000
      const loan = await hrService.createStaffLoan(T1, {
        employeeId: employee.id,
        title: 'وام ضروری پرسنل',
        principalAmount: 12_000_000,
        instalmentAmount: 1_000_000,
        totalInstalments: 12,
      });
      expect(loan.remainingAmount).toBe(12_000_000);
      expect(loan.status).toBe(LoanStatus.ACTIVE);

      // 2. Calculate payroll
      const run = await payrollRunService.createOrRecalculate(T1, {
        periodYear: 1405,
        periodMonth: 1,
      });

      const payslip = run.payslips[0];
      // loan instalment should be included in otherDeductions
      expect(payslip.otherDeductions).toBe(1_000_000);

      // 3. Post run to accounting
      await payrollRunService.postRun(T1, run.id);

      // 4. Verify loan balance was deducted
      const updatedLoan = await repository.findStaffLoanById(T1, loan.id);
      expect(updatedLoan?.paidInstalments).toBe(1);
      expect(updatedLoan?.remainingAmount).toBe(11_000_000);
      expect(updatedLoan?.status).toBe(LoanStatus.ACTIVE);
    });

    it('marks loan PAID_OFF when remaining balance reaches zero', async () => {
      const loan = await hrService.createStaffLoan(T1, {
        employeeId: employee.id,
        title: 'مساعده یک قسطی',
        principalAmount: 500_000,
        instalmentAmount: 500_000,
        totalInstalments: 1,
      });

      const run = await payrollRunService.createOrRecalculate(T1, {
        periodYear: 1405,
        periodMonth: 1,
      });

      await payrollRunService.postRun(T1, run.id);

      const updatedLoan = await repository.findStaffLoanById(T1, loan.id);
      expect(updatedLoan?.paidInstalments).toBe(1);
      expect(updatedLoan?.remainingAmount).toBe(0);
      expect(updatedLoan?.status).toBe(LoanStatus.PAID_OFF);
    });
  });

  describe('3. Leave Requests & Lifecycle', () => {
    it('allows requesting and reviewing leaves with Persian labels', async () => {
      const leave = await hrService.requestLeave(T1, {
        employeeId: employee.id,
        leaveType: LeaveType.ANNUAL,
        startDate: '1405/02/10',
        endDate: '1405/02/12',
        days: 2.5,
        description: 'مرخصی استحقاقی سالانه',
      });

      expect(leave.status).toBe(LeaveStatus.PENDING);
      expect(leave.leaveTypeLabel).toBe('استحقاقی');
      expect(leave.statusLabel).toBe('در انتظار بررسی');

      // Review leave: approve
      const reviewed = await hrService.reviewLeave(T1, leave.id, {
        status: LeaveStatus.APPROVED,
        approvedBy: 'مدیر اداری',
      });

      expect(reviewed.status).toBe(LeaveStatus.APPROVED);
      expect(reviewed.statusLabel).toBe('تأییدشده');
      expect(reviewed.approvedBy).toBe('مدیر اداری');
    });
  });
});
