/**
 * Fixed assets and depreciation on a REAL PostgreSQL. Opt-in like the other pg specs: skipped
 * unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { AccountingRepository } from './repositories/accounting.repository';
import { FixedAssetRepository } from './repositories/fixed-asset.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FixedAssetService } from './services/fixed-asset.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

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

describePg('Fixed assets on PostgreSQL', () => {
  const dbName = `rx_fa_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let assets: FixedAssetService;

  const base = {
    category: 'FURNITURE',
    assetAccountCode: '1113',
    accumulatedAccountCode: '1120',
    expenseAccountCode: '5060',
  };
  // 2026-04-10 is 1405/01/21.
  const make = (tenant: string, code: string, extra: object) =>
    assets.create(tenant, 'u', { ...base, code, name: code, acquisitionDate: '2026-04-10', ...extra } as never);
  const balance = async (tenant: string, code: string): Promise<string> =>
    (await ds.query(`SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = $2`, [tenant, code]))[0]?.balance;

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(
      ds.getRepository(ChartOfAccountEntity),
      ds.getRepository(JournalEntryEntity),
      ds.getRepository(JournalEntryLineEntity),
      ds.getRepository(PeriodLockEntity),
      ds,
    );
    accounting = new AccountingService(repo, currency);
    assets = new FixedAssetService(new FixedAssetRepository(ds), repo, accounting);
    const templates = new ChartTemplateService(repo);
    await templates.apply(T1, 'iran-trading');
    await templates.apply(T2, 'iran-trading');
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('registers assets and refuses duplicates, bad terms and unknown accounts', async () => {
    await make(T1, 'FA-1', { cost: '1200.00', method: 'STRAIGHT_LINE', lifeMonths: 12 });
    await make(T1, 'FA-2', { cost: '1000.00', method: 'DECLINING_BALANCE', annualRate: '0.24', rateSource: 'tax circular' });
    await expect(make(T1, 'FA-1', { cost: '1.00', method: 'STRAIGHT_LINE', lifeMonths: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(make(T1, 'FA-3', { cost: '1.00', method: 'STRAIGHT_LINE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(make(T1, 'FA-4', { cost: '1.00', method: 'STRAIGHT_LINE', lifeMonths: 1, expenseAccountCode: '9999' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(make(T1, 'FA-5', { cost: '10.00', salvageValue: '10.00', method: 'STRAIGHT_LINE', lifeMonths: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect((await assets.list(T1)).map((a) => [a.code, a.netBookValue])).toEqual([['FA-1', '1200.00'], ['FA-2', '1000.00']]);
    expect(await assets.list(T2)).toEqual([]);
  });

  it('posts one balanced entry per month, moves the ledger, and is idempotent', async () => {
    const first = await assets.runMonth(T1, { year: 1405, month: 1 });
    expect(first).toMatchObject({ entryNumber: 'DEP-140501-1', totalCharged: '120.00' });
    expect(first.charged).toEqual([{ code: 'FA-1', amount: '100.00' }, { code: 'FA-2', amount: '20.00' }]);
    expect(await balance(T1, '5060')).toBe('120.00');
    expect(await balance(T1, '1120')).toBe('-120.00');

    const again = await assets.runMonth(T1, { year: 1405, month: 1 });
    expect(again.entryNumber).toBeNull();
    expect(again.skipped.map((s) => s.reason)).toEqual(['ALREADY_DONE', 'ALREADY_DONE']);
    expect(await balance(T1, '5060')).toBe('120.00');
  });

  it('refuses to skip a month, and concurrent runs charge once', async () => {
    const gap = await assets.runMonth(T1, { year: 1405, month: 3 });
    expect(gap.skipped.map((s) => s.reason)).toEqual(['PREVIOUS_MONTH_MISSING', 'PREVIOUS_MONTH_MISSING']);
    const [a, b] = await Promise.all([assets.runMonth(T1, { year: 1405, month: 2 }), assets.runMonth(T1, { year: 1405, month: 2 })]);
    expect([a, b].filter((r) => r.entryNumber !== null)).toHaveLength(1);
    expect(await balance(T1, '5060')).toBe('239.60');
  });

  it('stops at the depreciable amount and marks the asset fully depreciated', async () => {
    // Acquired 2026-06-22 = 1405/04/01; one month of life leaves only the salvage value.
    await make(T1, 'FA-SHORT', { cost: '100.00', salvageValue: '40.00', method: 'STRAIGHT_LINE', lifeMonths: 1, acquisitionDate: '2026-06-22' });
    const r = await assets.runMonth(T1, { year: 1405, month: 4 });
    expect(r.charged.find((c) => c.code === 'FA-SHORT')).toEqual({ code: 'FA-SHORT', amount: '60.00' });
    expect(r.skipped.filter((s) => s.code !== 'FA-SHORT').map((s) => s.reason)).toEqual(['PREVIOUS_MONTH_MISSING', 'PREVIOUS_MONTH_MISSING']);
    const short = (await assets.list(T1)).find((a) => a.code === 'FA-SHORT')!;
    expect(short).toMatchObject({ status: 'FULLY_DEPRECIATED', netBookValue: '40.00' });
    const next = await assets.runMonth(T1, { year: 1405, month: 5 });
    expect([...next.charged, ...next.skipped].some((x) => x.code === 'FA-SHORT')).toBe(false);
  });

  it('rolls everything back when the period is locked', async () => {
    for (const month of [3, 4, 5, 6]) {
      await assets.runMonth(T1, { year: 1405, month });
    }
    // Mehr 1405 ends 2026-10-22.
    await accounting.lockPeriod(T1, 'u', { periodStart: '2026-10-01', periodEnd: '2026-10-31' } as never);
    const before = await balance(T1, '5060');
    await expect(assets.runMonth(T1, { year: 1405, month: 7 })).rejects.toMatchObject({ status: 423 });
    expect(await balance(T1, '5060')).toBe(before);
    const rows = await ds.query(`SELECT months_depreciated FROM fin_fixed_assets WHERE code = 'FA-1'`);
    expect(rows[0].months_depreciated).toBe(6);
  });

  it('shows another tenant nothing and the database refuses a double charge', async () => {
    expect(await assets.runMonth(T2, { year: 1405, month: 1 })).toMatchObject({ entryNumber: null, charged: [] });
    await expect(
      ds.query(`INSERT INTO fin_depreciation_lines (tenant_id, asset_id, period_year, period_month, amount, journal_entry_id)
                SELECT tenant_id, asset_id, period_year, period_month, amount, journal_entry_id FROM fin_depreciation_lines LIMIT 1`),
    ).rejects.toThrow(/UQ_fin_depreciation_lines_month/);
  });
});
