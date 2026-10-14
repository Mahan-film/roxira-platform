import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountingService } from '../accounting/services/accounting.service';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { HrController } from './controllers/hr.controller';
import { CreateContractDto } from './dto/create-contract.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { PayslipEntity } from './entities/payslip.entity';
import { ContractStatus, EmployeeStatus } from './enums/hr.enum';
import { HrRepository } from './repositories/hr.repository';
import { HrService } from './services/hr.service';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

/** سرویس حسابداری ساختگی که فراخوانی سند خودکار حقوق را ثبت می‌کند. */
class FakeAccountingService {
  calls: { tenantId: string; dto: { entryNumber: string } }[] = [];
  private sequence = 0;

  async createJournalEntry(
    tenantId: string,
    dto: { entryNumber: string },
  ): Promise<{ id: number; entryNumber: string }> {
    this.calls.push({ tenantId, dto });
    return { id: ++this.sequence, entryNumber: dto.entryNumber };
  }
}

/**
 * Repository درون‌حافظه‌ای که دقیقاً مثل نسخه واقعی هر خواندن/نوشتن را به
 * `tenantId` محدود می‌کند تا رفتار جداسازی مستأجر در سطح سرویس/کنترلر سنجیده شود.
 */
class InMemoryHrRepository {
  employees: EmployeeEntity[] = [];
  contracts: EmploymentContractEntity[] = [];
  payslips: PayslipEntity[] = [];
  private seq = 0;

  private nextId(): number {
    return ++this.seq;
  }

  async countEmployees(tenantId: string): Promise<number> {
    return this.employees.filter((row) => row.tenantId === tenantId).length;
  }

  async createEmployee(
    tenantId: string,
    data: Partial<EmployeeEntity>,
  ): Promise<EmployeeEntity> {
    const entity = { ...data, id: this.nextId(), tenantId } as EmployeeEntity;
    this.employees.push(entity);
    return entity;
  }

  async saveEmployee(
    tenantId: string,
    entity: EmployeeEntity,
  ): Promise<EmployeeEntity> {
    const index = this.employees.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index === -1) {
      return entity;
    }
    this.employees[index] = { ...this.employees[index], ...entity, tenantId };
    return this.employees[index];
  }

  async findEmployeeById(
    tenantId: string,
    id: number,
  ): Promise<EmployeeEntity | null> {
    return (
      this.employees.find(
        (row) => row.id === id && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findEmployeeByNationalId(
    tenantId: string,
    nationalId: string,
  ): Promise<EmployeeEntity | null> {
    return (
      this.employees.find(
        (row) => row.nationalId === nationalId && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findEmployeeByNumber(
    tenantId: string,
    employeeNumber: string,
  ): Promise<EmployeeEntity | null> {
    return (
      this.employees.find(
        (row) =>
          row.employeeNumber === employeeNumber && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findAndCountEmployees(
    tenantId: string,
    _options: unknown,
  ): Promise<[EmployeeEntity[], number]> {
    const rows = this.employees.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }

  async createContract(
    tenantId: string,
    data: Partial<EmploymentContractEntity>,
  ): Promise<EmploymentContractEntity> {
    const entity = {
      ...data,
      id: this.nextId(),
      tenantId,
    } as EmploymentContractEntity;
    this.contracts.push(entity);
    return entity;
  }

  async findContractById(
    tenantId: string,
    id: number,
  ): Promise<EmploymentContractEntity | null> {
    const contract =
      this.contracts.find(
        (row) => row.id === id && row.tenantId === tenantId,
      ) ?? null;
    if (!contract) {
      return null;
    }
    return {
      ...contract,
      employee:
        this.employees.find((row) => row.id === contract.employeeId) ?? undefined,
    } as EmploymentContractEntity;
  }

  async findContractByNumber(
    tenantId: string,
    contractNumber: string,
  ): Promise<EmploymentContractEntity | null> {
    return (
      this.contracts.find(
        (row) =>
          row.contractNumber === contractNumber && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findActiveContractByEmployee(
    tenantId: string,
    employeeId: number,
  ): Promise<EmploymentContractEntity | null> {
    return (
      this.contracts
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.employeeId === employeeId &&
            row.status === ContractStatus.ACTIVE,
        )
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }

  async findAndCountContracts(
    tenantId: string,
    options: { where?: Record<string, unknown> },
  ): Promise<[EmploymentContractEntity[], number]> {
    const employeeId = options.where?.employeeId as number | undefined;
    const rows = this.contracts
      .filter((row) => row.tenantId === tenantId)
      .filter((row) => (employeeId ? row.employeeId === employeeId : true))
      .map((row) => ({
        ...row,
        employee:
          this.employees.find((item) => item.id === row.employeeId) ?? undefined,
      }) as EmploymentContractEntity);
    return [rows, rows.length];
  }

  async countActiveContracts(tenantId: string): Promise<number> {
    return this.contracts.filter(
      (row) => row.tenantId === tenantId && row.status === ContractStatus.ACTIVE,
    ).length;
  }

  async countEmployeesByStatus(
    tenantId: string,
    status: EmployeeStatus,
  ): Promise<number> {
    return this.employees.filter(
      (row) => row.tenantId === tenantId && row.status === status,
    ).length;
  }

  async aggregateActiveContracts(
    tenantId: string,
  ): Promise<{ count: string; totalBaseSalary: string }> {
    const rows = this.contracts.filter(
      (row) => row.tenantId === tenantId && row.status === ContractStatus.ACTIVE,
    );
    const total = rows.reduce((sum, row) => sum + Number(row.baseSalary), 0);
    return { count: String(rows.length), totalBaseSalary: String(total) };
  }

  async createPayslip(
    tenantId: string,
    data: Partial<PayslipEntity>,
  ): Promise<PayslipEntity> {
    const entity = { ...data, id: this.nextId(), tenantId } as PayslipEntity;
    this.payslips.push(entity);
    return entity;
  }

  async findPayslipById(
    tenantId: string,
    id: number,
  ): Promise<PayslipEntity | null> {
    const payslip =
      this.payslips.find((row) => row.id === id && row.tenantId === tenantId) ??
      null;
    if (!payslip) {
      return null;
    }
    return {
      ...payslip,
      employee:
        this.employees.find((row) => row.id === payslip.employeeId) ?? undefined,
    } as PayslipEntity;
  }

  async findPayslipByPeriod(
    tenantId: string,
    employeeId: number,
    periodYear: number,
    periodMonth: number,
  ): Promise<PayslipEntity | null> {
    return (
      this.payslips.find(
        (row) =>
          row.tenantId === tenantId &&
          row.employeeId === employeeId &&
          row.periodYear === periodYear &&
          row.periodMonth === periodMonth,
      ) ?? null
    );
  }

  async findAndCountPayslips(
    tenantId: string,
    _options: unknown,
  ): Promise<[PayslipEntity[], number]> {
    const rows = this.payslips
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({
        ...row,
        employee:
          this.employees.find((item) => item.id === row.employeeId) ?? undefined,
      }) as PayslipEntity);
    return [rows, rows.length];
  }

  async savePayslip(
    tenantId: string,
    entity: PayslipEntity,
  ): Promise<PayslipEntity> {
    const index = this.payslips.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index === -1) {
      return entity;
    }
    this.payslips[index] = { ...this.payslips[index], ...entity, tenantId };
    return this.payslips[index];
  }

  async aggregatePayslips(tenantId: string): Promise<{
    count: string;
    totalGrossPay: string;
    totalNetPay: string;
    totalInsurance: string;
    totalTax: string;
    totalOtherDeductions: string;
  }> {
    const rows = this.payslips.filter((row) => row.tenantId === tenantId);
    return {
      count: String(rows.length),
      totalGrossPay: String(
        rows.reduce((sum, row) => sum + Number(row.grossPay), 0),
      ),
      totalNetPay: String(
        rows.reduce((sum, row) => sum + Number(row.netPay), 0),
      ),
      totalInsurance: String(
        rows.reduce((sum, row) => sum + Number(row.insuranceDeduction), 0),
      ),
      totalTax: String(
        rows.reduce((sum, row) => sum + Number(row.incomeTax), 0),
      ),
      totalOtherDeductions: String(
        rows.reduce((sum, row) => sum + Number(row.otherDeductions), 0),
      ),
    };
  }
}

const buildEmployeeDto = (
  overrides: Partial<CreateEmployeeDto> = {},
): CreateEmployeeDto =>
  ({
    employeeNumber: 'EMP-000001',
    firstName: 'سارا',
    lastName: 'محمدی',
    nationalId: '0079541234',
    mobile: '09121234567',
    jobTitle: 'کارشناس منابع انسانی',
    department: 'منابع انسانی',
    ...overrides,
  }) as CreateEmployeeDto;

const buildContractDto = (
  employeeId: number,
  overrides: Partial<CreateContractDto> = {},
): CreateContractDto =>
  ({
    employeeId,
    startDate: '2026-01-01',
    baseSalary: 100_000_000,
    ...overrides,
  }) as CreateContractDto;

const buildService = () => {
  const repository = new InMemoryHrRepository() as unknown as HrRepository;
  const accountingService =
    new FakeAccountingService() as unknown as AccountingService;
  return {
    repository,
    accountingService,
    service: new HrService(repository, accountingService),
  };
};

const createEmployeeWithContract = async (
  service: HrService,
  tenantId: string,
  overrides: Partial<CreateEmployeeDto> = {},
) => {
  const employee = await service.createEmployee(
    tenantId,
    buildEmployeeDto(overrides),
  );
  const contract = await service.createContract(
    tenantId,
    buildContractDto(employee.id),
  );
  return { employee, contract };
};

describe('HrService — cross-tenant isolation', () => {
  it('does not read another tenant employee (404)', async () => {
    const { service } = buildService();
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');

    await expect(
      service.findOneEmployee('tenant-b', employee.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only the current tenant employees', async () => {
    const { service } = buildService();
    await service.createEmployee('tenant-a', buildEmployeeDto());
    await service.createEmployee(
      'tenant-b',
      buildEmployeeDto({ employeeNumber: 'EMP-B-1', nationalId: '1111111111' }),
    );

    const tenantA = await service.listEmployees('tenant-a', {
      page: 1,
      limit: 20,
    } as never);
    expect(tenantA.total).toBe(1);
  });

  it('does not update another tenant employee (404)', async () => {
    const { service } = buildService();
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');

    await expect(
      service.updateEmployee('tenant-b', employee.id, { jobTitle: 'تغییر' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not create a contract for another tenant employee (404)', async () => {
    const { service } = buildService();
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');

    await expect(
      service.createContract(
        'tenant-b',
        buildContractDto(employee.id),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not calculate payroll for another tenant employee (404)', async () => {
    const { service } = buildService();
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');

    await expect(
      service.calculatePayroll('tenant-b', { employeeId: employee.id } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not issue a payslip for another tenant employee (404)', async () => {
    const { service } = buildService();
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');

    await expect(
      service.issuePayslip('tenant-b', {
        employeeId: employee.id,
        periodYear: 1405,
        periodMonth: 1,
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the same employeeNumber and nationalId in two tenants', async () => {
    const { service } = buildService();

    await expect(
      service.createEmployee('tenant-a', buildEmployeeDto()),
    ).resolves.toBeDefined();
    await expect(
      service.createEmployee('tenant-b', buildEmployeeDto()),
    ).resolves.toBeDefined();
    await expect(
      service.createEmployee('tenant-a', buildEmployeeDto()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('HrService — payroll journal lands in the same tenant', () => {
  it('passes the tenant through to the accounting journal entry', async () => {
    const { service, accountingService } = buildService();
    const fake = accountingService as unknown as FakeAccountingService;
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');

    const payslip = await service.issuePayslip('tenant-a', {
      employeeId: employee.id,
      periodYear: 1405,
      periodMonth: 1,
    } as never);

    expect(payslip.journalEntryId).toBeDefined();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].tenantId).toBe('tenant-a');
    expect(fake.calls[0].dto.entryNumber).toContain('PY-');
  });

  it('enforces payslip uniqueness per (tenant, employee, period)', async () => {
    const { service } = buildService();
    const tenantA = await createEmployeeWithContract(service, 'tenant-a');
    const tenantB = await createEmployeeWithContract(service, 'tenant-b', {
      employeeNumber: 'EMP-B-1',
      nationalId: '1111111111',
    });

    const period = { periodYear: 1405, periodMonth: 1 } as const;

    await expect(
      service.issuePayslip('tenant-a', {
        employeeId: tenantA.employee.id,
        ...period,
      } as never),
    ).resolves.toBeDefined();

    // همان دوره برای همان کارمند در همان سازمان مجاز نیست.
    await expect(
      service.issuePayslip('tenant-a', {
        employeeId: tenantA.employee.id,
        ...period,
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    // همان دوره برای کارمند سازمان دیگر مجاز است.
    await expect(
      service.issuePayslip('tenant-b', {
        employeeId: tenantB.employee.id,
        ...period,
      } as never),
    ).resolves.toBeDefined();
  });

  it('does not list another tenant payslips', async () => {
    const { service } = buildService();
    const tenantA = await createEmployeeWithContract(service, 'tenant-a');

    await service.issuePayslip('tenant-a', {
      employeeId: tenantA.employee.id,
      periodYear: 1405,
      periodMonth: 2,
    } as never);

    const tenantB = await service.listPayslips('tenant-b', {
      page: 1,
      limit: 20,
    } as never);
    expect(tenantB.total).toBe(0);
  });
});

describe('HrController — tenant access rules', () => {
  const setup = async () => {
    const { service } = buildService();
    const controller = new HrController(service);
    const { employee } = await createEmployeeWithContract(service, 'tenant-a');
    return { controller, employeeId: employee.id };
  };

  it('denies a user with a null tenant (403)', async () => {
    const { controller, employeeId } = await setup();

    await expect(
      controller.getEmployee(
        requestWith({ tenantId: null, role: UserRole.ADMIN }),
        employeeId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a plain MEMBER (403)', async () => {
    const { controller, employeeId } = await setup();

    await expect(
      controller.getEmployee(
        requestWith({
          tenantId: 'tenant-a',
          role: UserRole.USER,
          tenantRole: TenantRole.MEMBER,
        }),
        employeeId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the platform ADMIN of the owning tenant', async () => {
    const { controller, employeeId } = await setup();

    const result = await controller.getEmployee(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      employeeId,
    );

    expect(result.id).toBe(employeeId);
  });

  it('allows the tenant OWNER', async () => {
    const { controller, employeeId } = await setup();

    const result = await controller.getEmployee(
      requestWith({
        tenantId: 'tenant-a',
        role: UserRole.USER,
        tenantRole: TenantRole.OWNER,
      }),
      employeeId,
    );

    expect(result.id).toBe(employeeId);
  });

  it('does not let the OWNER of another tenant read tenant A employee (404)', async () => {
    const { controller, employeeId } = await setup();

    await expect(
      controller.getEmployee(
        requestWith({
          tenantId: 'tenant-b',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
        employeeId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('HrRepository — tenant scoping', () => {
  it('scopes findEmployeeById by tenantId', async () => {
    const employees = { findOne: jest.fn(async () => null) };
    const repository = new HrRepository(
      employees as never,
      {} as never,
      {} as never,
    );

    await repository.findEmployeeById('tenant-a', 1);

    expect(employees.findOne).toHaveBeenCalledWith({
      where: { id: 1, tenantId: 'tenant-a' },
    });
  });

  it('stamps tenantId on createEmployee', async () => {
    const employees = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new HrRepository(
      employees as never,
      {} as never,
      {} as never,
    );

    await repository.createEmployee('tenant-a', { firstName: 'سارا' });

    expect(employees.create).toHaveBeenCalledWith({
      firstName: 'سارا',
      tenantId: 'tenant-a',
    });
  });

  it('updates employees by (id, tenantId) so a foreign id affects zero rows', async () => {
    const employees = { update: jest.fn(async () => undefined) };
    const repository = new HrRepository(
      employees as never,
      {} as never,
      {} as never,
    );

    await repository.saveEmployee('tenant-a', {
      id: 1,
      tenantId: 'tenant-b',
    } as EmployeeEntity);

    expect(employees.update).toHaveBeenCalledWith(
      { id: 1, tenantId: 'tenant-a' },
      expect.any(Object),
    );
  });

  it('scopes findPayslipByPeriod by tenantId', async () => {
    const payslips = { findOne: jest.fn(async () => null) };
    const repository = new HrRepository(
      {} as never,
      {} as never,
      payslips as never,
    );

    await repository.findPayslipByPeriod('tenant-a', 7, 1405, 1);

    expect(payslips.findOne).toHaveBeenCalledWith({
      where: {
        employeeId: 7,
        periodYear: 1405,
        periodMonth: 1,
        tenantId: 'tenant-a',
      },
    });
  });
});