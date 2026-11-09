/**
 * Cost-centre tree and the trial balance by cost centre (E3.2) on a REAL PostgreSQL. Opt-in like the
 * other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

const rial = (value: string) => fromDb(value);

describePg('Cost centres on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
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
    testDb = await createTestDatabase('cc');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    const dimensionRepo = new DimensionRepository(testDb.app);
    dims = new DimensionService(dimensionRepo);
    const ledger = new LedgerReportRepository(testDb.scope);
    const reports = new FinancialReportsService(repo, new FiscalYearRepository(testDb.app), ledger);
    report = new CostCentreReportService(reports, ledger, dimensionRepo);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
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
    await expect(testDb.rawQuery(`UPDATE fin_dimensions SET parent_id = id WHERE code = 'CC-200'`)).rejects.toThrow();
    const project = await dims.create(T1, { kind: DimensionKind.PROJECT, code: 'PR-1', name: 'Tower' });
    await expect(
      testDb.rawQuery(`UPDATE fin_dimensions SET parent_id = (SELECT id FROM fin_dimensions WHERE code = 'CC-100') WHERE id = $1`, [
        project.id,
      ]),
    ).rejects.toThrow();
    await testDb.rawQuery(`SELECT set_config('app.tenant_id', $1, false)`, [T2]);
    try {
      await expect(
        testDb.rawQuery(
          `INSERT INTO fin_dimensions (tenant_id, kind, code, name, parent_id)
           VALUES ($1, 'COST_CENTER', 'X', 'x', (SELECT min(id) FROM fin_dimensions))`,
          [T2],
        ),
      ).rejects.toThrow();
    } finally {
      await testDb.rawQuery(`SELECT set_config('app.tenant_id', '', false)`);
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
