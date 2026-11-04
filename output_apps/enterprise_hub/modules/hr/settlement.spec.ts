import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessAction } from '../access/catalogue';
import { ACCESS_ACTION_KEY } from '../access/decorators';
import { HrController } from './controllers/hr.controller';
import { PreviewSettlementDto } from './dto/settlement.dto';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { HrRepository } from './repositories/hr.repository';
import { HrService } from './services/hr.service';
import { fakeStatutory, TENANT_ROWS } from './statutory/__fixtures__/seeded-rates';
import { StatutoryParameterEntity, StatutorySourceKind } from './statutory/statutory-parameter.entity';

const A = 'tenant-a';
const B = 'tenant-b';

/** Tenant-scoped like the real repository: a row of another tenant is never returned. */
class FakeRepo {
  employees = [
    { id: 1, tenantId: A, hireDate: '2020-03-21' },
    { id: 2, tenantId: B, hireDate: '2020-03-21' },
    { id: 3, tenantId: A, hireDate: '2026-01-01' },
  ] as EmployeeEntity[];
  contracts = [
    { employeeId: 1, tenantId: A, baseSalary: 150_000_000 },
    { employeeId: 2, tenantId: B, baseSalary: 150_000_000 },
  ] as EmploymentContractEntity[];

  async findEmployeeById(tenantId: string, id: number) {
    return this.employees.find((e) => e.id === id && e.tenantId === tenantId) ?? null;
  }
  async findActiveContractByEmployee(tenantId: string, employeeId: number) {
    return this.contracts.find((c) => c.employeeId === employeeId && c.tenantId === tenantId) ?? null;
  }
}

const service = () => new HrService(new FakeRepo() as unknown as HrRepository, {} as never, fakeStatutory());

describe('settlement preview', () => {
  afterEach(() => {
    delete TENANT_ROWS[A];
  });

  it('computes sanavat and leave pay from the stored parameters', async () => {
    // base 150,000,000 / 30 = 5,000,000 a day; 2020-03-21..2026-12-31 = 6 years + 286 days.
    const r = await service().previewSettlement(A, 1, { endDate: '2026-12-31', unusedLeaveDays: 2.5 });
    expect(r.fullYears).toBe(6);
    expect(r.extraDays).toBe(286);
    expect(r.dailyWage).toBe('5000000');
    expect(r.endOfServiceBenefit).toBe((6n * 150_000_000n + 117_534_247n).toString());
    expect(r.leaveSettlement).toBe('12500000');
    expect(BigInt(r.total)).toBe(BigInt(r.endOfServiceBenefit) + 12_500_000n);
    expect(r.parameters.map((p) => p.key).sort()).toEqual([
      'payroll_month_days',
      'sanavat_days_per_year',
      'sanavat_year_days',
    ]);
    expect(r.parameters.every((p) => p.version === 1 && !p.tenantOverride)).toBe(true);
  });

  it('uses a tenant override from its effective date, and only for that tenant', async () => {
    const override = (key: string, value: number): StatutoryParameterEntity => ({
      id: key, tenantId: A, country: 'IR', fiscalYear: 1405, paramKey: key, effectiveFrom: '2026-06-01',
      version: 1, value, source: 'x', sourceKind: StatutorySourceKind.TENANT, verified: true,
      createdBy: 'u', createdAt: new Date(0),
    });
    TENANT_ROWS[A] = [override('sanavat_days_per_year', 45), override('sanavat_year_days', 360)];
    const svc = service();
    const before = await svc.previewSettlement(A, 1, { endDate: '2026-05-31' });
    const after = await svc.previewSettlement(A, 1, { endDate: '2026-12-31' });
    expect(before.parameters.find((p) => p.key === 'sanavat_days_per_year')?.value).toBe(30);
    expect(after.parameters.find((p) => p.key === 'sanavat_days_per_year')).toMatchObject({
      value: 45, tenantOverride: true,
    });
    expect(after.endOfServiceBenefit).toBe((6n * 225_000_000n + (225_000_000n * 286n * 2n + 360n) / 720n).toString());
    // Tenant B's identical employee is unaffected.
    const other = await svc.previewSettlement(B, 2, { endDate: '2026-12-31' });
    expect(other.parameters.every((p) => !p.tenantOverride)).toBe(true);
  });

  it('never reveals another tenant\'s employee', async () => {
    await expect(service().previewSettlement(A, 2, { endDate: '2026-12-31' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service().previewSettlement(B, 1, { endDate: '2026-12-31' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an employee without an active contract and an end date before hiring', async () => {
    await expect(service().previewSettlement(A, 3, { endDate: '2026-12-31' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().previewSettlement(A, 1, { endDate: '2019-01-01' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when the parameters are missing for the date', async () => {
    await expect(service().previewSettlement(A, 1, { endDate: '2010-01-01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('settlement endpoint contract', () => {
  const dto = (plain: object) => validate(plainToInstance(PreviewSettlementDto, plain));

  it('validates the body', async () => {
    expect(await dto({ endDate: '2026-12-31', unusedLeaveDays: 2.5 })).toHaveLength(0);
    expect(await dto({ endDate: '2026-12-31' })).toHaveLength(0);
    expect(await dto({})).not.toHaveLength(0);
    expect(await dto({ endDate: 'soon' })).not.toHaveLength(0);
    expect(await dto({ endDate: '2026-12-31', unusedLeaveDays: -1 })).not.toHaveLength(0);
    expect(await dto({ endDate: '2026-12-31', unusedLeaveDays: 1.234 })).not.toHaveLength(0);
  });

  it('needs hr:read and takes the tenant from the token', async () => {
    expect(Reflect.getMetadata(ACCESS_ACTION_KEY, HrController.prototype.previewSettlement)).toBe(AccessAction.READ);
    const svc = { previewSettlement: jest.fn(async () => ({})) };
    const controller = new HrController(svc as never, {} as never);
    await controller.previewSettlement(
      { user: { tenantId: A, role: 'admin' } } as never, 1, { endDate: '2026-12-31' } as never,
    );
    expect(svc.previewSettlement).toHaveBeenCalledWith(A, 1, { endDate: '2026-12-31' });
  });
});
