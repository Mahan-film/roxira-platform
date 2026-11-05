/**
 * Monthly payroll against a REAL PostgreSQL: migrations, entities, statutory store, cumulative tax
 * across posted months, journal lines and exports. Skipped unless ROXIRA_TEST_PG_HOST is set; each
 * run creates and drops its own database. Accounting is a fake that rejects unbalanced entries.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/hr/payroll.pg.spec.ts
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AuditService } from '../access/services/audit.service';
import { AccountingService } from '../accounting/services/accounting.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { ContractAllowanceEntity } from './entities/contract-allowance.entity';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { PayrollRunEntity } from './entities/payroll-run.entity';
import { PayslipEntity } from './entities/payslip.entity';
import { AllowanceTaxTreatment, Gender, MaritalStatus } from './enums/hr.enum';
import { HrRepository } from './repositories/hr.repository';
import { readDbf } from './services/dbf-file';
import { HrService } from './services/hr.service';
import { compareInsuranceTotals } from './services/insurance-list';
import { PayrollRunService } from './services/payroll-run.service';
import { StatutoryRepository } from './statutory/statutory.repository';
import { StatutoryService } from './statutory/statutory.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const M = 1_000_000;

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432,
  username: process.env.ROXIRA_TEST_PG_USER ?? 'postgres',
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('monthly payroll on PostgreSQL', () => {
  const db = `payroll_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let runs: PayrollRunService;
  const entries: { entryNumber: string; lines: { debit?: number; credit?: number }[] }[] = [];

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = await new DataSource(options(db)).initialize();
    await ds.runMigrations();

    const repository = new HrRepository(new TenantScope(ds), ds);
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
        const [row] = await ds.query(
          `INSERT INTO fin_journal_entries (tenant_id, entry_number, description)
           VALUES ($1, $2, 'test') RETURNING id`,
          [T1, dto.entryNumber],
        );
        return { id: row.id, entryNumber: dto.entryNumber };
      },
    } as unknown as AccountingService;
    const statutory = new StatutoryService(
      new StatutoryRepository(new TenantScope(ds)),
      { record: async () => undefined } as unknown as AuditService,
    );
    const postingRules = new PostingRulesService(
      new PostingRulesRepository(new TenantScope(ds)),
      accounting,
    );
    const hr = new HrService(repository, accounting, statutory, postingRules);
    runs = new PayrollRunService(
      repository,
      hr,
      accounting,
      statutory,
      postingRules,
    );

    const now = new Date();
    const employee = await ds.getRepository(EmployeeEntity).save({
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
    const contract = await ds.getRepository(EmploymentContractEntity).save({
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
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
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
});
