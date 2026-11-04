/**
 * Cost-centre tree and the trial balance by cost centre (E3.2) on a REAL PostgreSQL. Opt-in like the
 * other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CurrencyService } from '../currency/services/currency.service';
import { DimensionKind, JournalEntryStatus } from './enums/accounting.enum';
import { fromDb } from './money';
import { AccountingRepository } from './repositories/accounting.repository';
import { DimensionRepository } from './repositories/dimension.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { CostCentreReportService, UNASSIGNED_CENTRE_NAME } from './services/cost-centre-report.service';
import { DimensionService } from './services/dimension.service';
import { FinancialReportsService } from './services/financial-reports.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const rial = (value: string) => fromDb(value);

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const admin = async (sql: string) => {
  const ds = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
};

describePg('Cost centres on PostgreSQL', () => {
  const dbName = `rx_cc_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let dims: DimensionService;
  let report: CostCentreReportService;
  const range = { from: '2026-04-01', to: '2026-06-30' };

  const post = (entryNumber: string, amount: string, costCenterCode?: string, status = JournalEntryStatus.POSTED) =>
    accounting.createJournalEntry(T1, {
      entryNumber,
      date: '2026-05-01',
      description: 't',
      status,
      lines: [
        { accountCode: '5020', debit: amount, costCenterCode },
        { accountCode: '1010', credit: amount },
      ],
    } as never);

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(new TenantScope(ds));
    accounting = new AccountingService(repo, currency);
    const dimensionRepo = new DimensionRepository(ds);
    dims = new DimensionService(dimensionRepo);
    const ledger = new LedgerReportRepository(new TenantScope(ds));
    const reports = new FinancialReportsService(repo, new FiscalYearRepository(ds), ledger);
    report = new CostCentreReportService(reports, ledger, dimensionRepo);
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('builds a cost-centre tree and refuses a bad parent', async () => {
    const sales = await dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-100', name: 'Sales' });
    const shop = await dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-110', name: 'Shop', parentCode: 'CC-100' });
    await dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-200', name: 'Admin' });
    expect(shop.parentId).toBe(sales.id);
    await expect(
      dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-300', name: 'x', parentCode: 'NOPE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      dims.create(T1, { kind: DimensionKind.PROJECT, code: 'PR-1', name: 'x', parentCode: 'CC-100' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Another organisation cannot hang a centre under T1's centre.
    await expect(
      dims.create(T2, { kind: DimensionKind.COST_CENTER, code: 'CC-110', name: 'x', parentCode: 'CC-100' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await dims.list(T2)).toEqual([]);
  });

  it('refuses a self, cross-kind or cross-tenant parent at the database', async () => {
    await expect(ds.query(`UPDATE fin_dimensions SET parent_id = id WHERE code = 'CC-200'`)).rejects.toThrow();
    const project = await dims.create(T1, { kind: DimensionKind.PROJECT, code: 'PR-1', name: 'Tower' });
    await expect(
      ds.query(`UPDATE fin_dimensions SET parent_id = (SELECT id FROM fin_dimensions WHERE code = 'CC-100') WHERE id = $1`, [
        project.id,
      ]),
    ).rejects.toThrow();
    await ds.query(`SELECT set_config('app.tenant_id', $1, false)`, [T2]);
    try {
      await expect(
        ds.query(
          `INSERT INTO fin_dimensions (tenant_id, kind, code, name, parent_id)
           VALUES ($1, 'COST_CENTER', 'X', 'x', (SELECT min(id) FROM fin_dimensions))`,
          [T2],
        ),
      ).rejects.toThrow();
    } finally {
      await ds.query(`SELECT set_config('app.tenant_id', '', false)`);
    }
  });

  it('splits the trial balance by cost centre and rolls children into the parent', async () => {
    await post('A1', '100.00', 'CC-110');
    await post('A2', '40.00', 'CC-100');
    await post('A3', '7.00', 'CC-200');
    await post('A4', '3.00');
    await post('A5-DRAFT', '1000.00', 'CC-110', JournalEntryStatus.DRAFT);

    const tb = await report.trialBalance(T1, range);
    expect(tb.centres.map((c) => [c.code, c.depth, c.parentCode])).toEqual([
      ['CC-100', 0, null],
      ['CC-110', 1, 'CC-100'],
      ['CC-200', 0, null],
      [null, 0, null],
    ]);
    const debit = (code: string | null) => tb.centres.find((c) => c.code === code)!.totals.periodDebit;
    expect(debit('CC-100')).toBe(rial('140.00'));
    expect(debit('CC-110')).toBe(rial('100.00'));
    expect(debit('CC-200')).toBe(rial('7.00'));
    const untagged = tb.centres.find((c) => c.code === null)!;
    expect(untagged.name).toBe(UNASSIGNED_CENTRE_NAME);
    expect(untagged.rows.map((r) => [r.code, r.periodDebit, r.periodCredit])).toEqual([
      ['1010', 0n, rial('150.00')],
      ['5020', rial('3.00'), 0n],
    ]);
    // Each line is counted once in the totals, and the whole ledger balances.
    expect(tb.totals.periodDebit).toBe(rial('150.00'));
    expect(tb.totals.periodCredit).toBe(rial('150.00'));
    expect(tb.balanced).toBe(true);
  });

  it('limits the report to one centre subtree and refuses an unknown centre', async () => {
    const tb = await report.trialBalance(T1, { ...range, costCenterCode: 'CC-100' });
    expect(tb.centres.map((c) => c.code)).toEqual(['CC-100', 'CC-110']);
    expect(tb.totals.periodDebit).toBe(rial('140.00'));
    expect(tb.totals.periodCredit).toBe(0n);
    expect(tb.balanced).toBeNull();
    await expect(report.trialBalance(T1, { ...range, costCenterCode: 'NOPE' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(report.trialBalance(T2, { ...range, costCenterCode: 'CC-100' })).rejects.toBeInstanceOf(NotFoundException);
    expect((await report.trialBalance(T2, range)).centres).toEqual([]);
  });
});
